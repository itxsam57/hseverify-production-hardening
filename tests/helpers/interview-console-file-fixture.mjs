import { createHash } from "node:crypto";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";
const { deriveSecureFileObjectKey } = loadWorkerRegistrationTs("src/lib/secure-files/secure-file-domain.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
export const consoleFixtureId = (prefix, seed) => prefix + "_" + hash(seed).slice(0, 24);

// Controlled accepted scan provenance. This fixture does not certify a live scanner.
export async function seedConsoleFile(db, workerAccountId, seed, { photo = false } = {}) {
  const fileId = consoleFixtureId("secure_file", seed);
  const jobId = consoleFixtureId("job", seed);
  const objectKey = deriveSecureFileObjectKey(fileId);
  const bytes = photo
    ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPoWbDvPwAGkALqhIRf9gAAAABJRU5ErkJggg==", "base64")
    : Buffer.from("%PDF-1.4\n" + seed + "\n%%EOF\n");
  const mime = photo ? "image/png" : "application/pdf";
  await db.query(
    `INSERT INTO platform_secure_files(file_id,schema_version,reservation_key,owner_account_id,owner_role,
      storage_adapter_key,object_key,display_filename)
     VALUES($1,1,$2,$3,'worker','local_test',$4,$5)`,
    [fileId, hash("reservation:" + seed), workerAccountId, objectKey, seed + (photo ? ".png" : ".pdf")]
  );
  await db.query(
    `UPDATE platform_secure_files SET lifecycle_status='quarantined',file_extension=$2,declared_mime=$3,
      detected_mime=$3,byte_size=$4,content_sha256=$5 WHERE file_id=$1`,
    [fileId, photo ? "png" : "pdf", mime, bytes.byteLength, hash(bytes)]
  );
  await db.query(
    `INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role)
     VALUES($1,'secure_file.scan',1,$2,$3::jsonb,$4,'worker')`,
    [jobId, hash("scan:" + seed), JSON.stringify({fileRef:fileId,generation:1}), workerAccountId]
  );
  await db.query("UPDATE platform_secure_files SET lifecycle_status='scan_pending',scan_generation=1,scan_job_id=$2 WHERE file_id=$1", [fileId,jobId]);
  await db.query("UPDATE platform_secure_files SET lifecycle_status='available',scan_result_code='clean' WHERE file_id=$1", [fileId]);
  return {fileId,objectKey,bytes};
}

export async function seedConsoleEvidence(db, workerAccountId, kind, seed, { file = null } = {}) {
  const recordId=consoleFixtureId("evidence_record",kind+":"+seed);
  const versionId=consoleFixtureId("evidence_version",kind+":"+seed);
  const now=new Date().toISOString();
  await db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES($1,$2,$3,'active',NULL,$4,$4)",[recordId,workerAccountId,kind,now]);
  await db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,version_status,created_at,updated_at,submitted_at) VALUES($1,$2,1,'submitted',$3,$3,$3)",[versionId,recordId,now]);
  await db.query("UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1",[recordId,versionId]);
  if(kind==="qualification") await db.query("INSERT INTO worker_qualification_versions(version_id,qualification_title,issuing_organization,qualification_level,declaration_accepted) VALUES($1,$2,'Console issuer','Level 3',TRUE)",[versionId,seed+" qualification"]);
  if(kind==="employment") await db.query("INSERT INTO worker_employment_versions(version_id,company_name,role_title,duties,country,start_date,employment_status) VALUES($1,$2,'Electrician','Observed workplace duties.','Pakistan','2025-01-01','current')",[versionId,seed+" employer"]);
  if(file) await db.query(
    "INSERT INTO worker_evidence_attachments(attachment_id,record_id,version_id,attachment_kind,secure_file_id,display_filename,created_at) VALUES($1,$2,$3,$4,$5,'Console evidence.pdf',$6)",
    [consoleFixtureId("attachment",kind+":"+seed),recordId,versionId,kind==="qualification"?"primary_certificate":"employment_evidence",file.fileId,now]);
  return {recordId,versionId};
}

// Valid frozen identity context for projection/access checks, not identity-provider certification.
export async function seedConsoleIdentity(db, workerAccountId, seed) {
  const identityId=consoleFixtureId("worker_identity",seed),versionId=consoleFixtureId("identity_version",seed);
  await db.query("INSERT INTO worker_identities(identity_id,worker_account_id) VALUES($1,$2)",[identityId,workerAccountId]);
  await db.query("INSERT INTO worker_identity_versions(identity_version_id,identity_id,version_number,version_kind,version_status,created_by_account_id) VALUES($1,$2,1,'initial','draft',$3)",[versionId,identityId,workerAccountId]);
  await db.query("UPDATE auth_accounts SET phone_e164='+923110000983',phone_verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE account_id=$1",[workerAccountId]);
  await db.query(
    `INSERT INTO worker_identity_version_drafts(identity_version_id,draft_revision,legal_first_name,legal_last_name,
      date_of_birth,nationality,country_of_residence,verified_email_normalized,email_verified_at,
      verified_phone_e164,phone_verified_at,contact_snapshot_at,created_at,updated_at)
     SELECT $1,1,'Console','Worker','1990-01-01','Pakistani','Pakistan',email_normalized,email_verified_at,
       phone_e164,phone_verified_at,clock_timestamp(),clock_timestamp(),clock_timestamp() FROM auth_accounts WHERE account_id=$2`,
    [versionId,workerAccountId]);
  const files={};
  for(const purpose of ["identity_document","profile_photo","selfie"]) {
    const file=await seedConsoleFile(db,workerAccountId,seed+":"+purpose,{photo:purpose!=="identity_document"});
    await db.query(
      "INSERT INTO worker_identity_evidence_bindings(binding_id,identity_version_id,worker_account_id,purpose,secure_file_id,document_type,document_number,created_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$3)",
      [consoleFixtureId("identity_evidence",seed+":"+purpose),versionId,workerAccountId,purpose,file.fileId,purpose==="identity_document"?"passport":null,purpose==="identity_document"?"PRIVATE-PASSPORT-CONSOLE":null]);
    files[purpose]=file;
  }
  await db.query("UPDATE worker_identity_versions SET version_status='submitted',submitted_at=clock_timestamp() WHERE identity_version_id=$1",[versionId]);
  for(const status of ["submitted","automated_checks","manual_review","verified"])
    await db.query("UPDATE worker_identities SET lifecycle_status=$2,lock_version=lock_version+1 WHERE identity_id=$1",[identityId,status]);
  await db.query("INSERT INTO worker_identity_duplicate_checks(check_id,identity_id,identity_version_id,worker_account_id,check_sequence,check_status,created_at) VALUES($1,$2,$3,$4,1,'clear',clock_timestamp())",[consoleFixtureId("identity_duplicate_check",seed),identityId,versionId,workerAccountId]);
  const workerId=consoleFixtureId("worker_id",seed);
  await db.query("INSERT INTO worker_identity_worker_ids(permanent_worker_id,identity_id,identity_version_id,worker_account_id,issued_by_component,issued_at) VALUES($1,$2,$3,$4,'identity-assurance',clock_timestamp())",[workerId,identityId,versionId,workerAccountId]);
  return {identityId,versionId,workerId,...files};
}
