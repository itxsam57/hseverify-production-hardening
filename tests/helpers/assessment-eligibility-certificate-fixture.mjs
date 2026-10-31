import { createHash } from "node:crypto";

// Scanned file metadata is a schema-valid prerequisite; qualification submit/review use original services.
export async function seedEligibilityCertificate(database,worker,record,now) {
 const token=record.currentVersion.versionId.slice(-24),fileId="secure_file_"+token,jobId="job_eligibility_certificate_"+token;
 const hash=createHash("sha256").update(token).digest("hex"), timestamp=now.toISOString();
 await database.query(`INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,
  enqueued_by_account_id,enqueued_by_role,status,attempt_count,max_attempts,next_attempt_at,succeeded_at,created_at,updated_at)
  VALUES($1,'secure_file.scan',1,$2,$3::jsonb,$4,'worker','succeeded',1,5,$5,$5,$5,$5)`,
  [jobId,hash,JSON.stringify({fileRef:fileId,generation:1}),worker.accountId,timestamp]);
 await database.query(`INSERT INTO platform_secure_files(file_id,schema_version,reservation_key,owner_account_id,owner_role,
  tenant_id,membership_id,storage_adapter_key,object_key,display_filename,lifecycle_status,file_extension,declared_mime,detected_mime,
  byte_size,content_sha256,quarantined_at,available_at,created_at,updated_at,scan_generation,scan_job_id,scan_result_code,scan_completed_at)
  VALUES($1,1,$2,$3,'worker',NULL,NULL,'local_test',$4,'qualification.pdf','available','pdf','application/pdf','application/pdf',
  128,$2,$5,$5,$5,$5,1,$6,'clean',$5)`,
  [fileId,hash,worker.accountId,"secure-files/"+hash,timestamp,jobId]);
 await database.query(`INSERT INTO worker_evidence_attachments(attachment_id,record_id,version_id,attachment_kind,
  secure_file_id,display_filename,created_at,superseded_at) VALUES($1,$2,$3,'primary_certificate',$4,'qualification.pdf',$5,NULL)`,
  ["evidence_attachment_"+token,record.recordId,record.currentVersion.versionId,fileId,timestamp]);
 return fileId;
}
