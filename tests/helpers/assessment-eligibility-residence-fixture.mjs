// Schema-valid frozen identity prerequisites; original review service decides verification and issues the permanent Worker ID.
export async function seedEligibilityResidenceIdentity(db, workerAccountId, now) {
  const NOW=now.toISOString();
  const oid=(prefix,c)=>prefix+"_"+c.repeat(24);
  const identityId = oid("worker_identity", "I");
  const versionId = oid("identity_version", "V");
  const account = await db.query(
    `SELECT email_normalized FROM auth_accounts WHERE account_id=$1`,
    [workerAccountId]
  );
  const email = account.rows[0].email_normalized;
  const phone = "+923000000002";

  await db.query(
    `UPDATE auth_accounts
        SET phone_e164=$2,phone_verified_at=$3,email_verified_at=$3,updated_at=$3
      WHERE account_id=$1`,
    [workerAccountId, phone, NOW]
  );
  await db.query(
    `INSERT INTO worker_identities(
       identity_id,worker_account_id,lifecycle_status,current_version_number,
       lock_version,created_at,updated_at
     ) VALUES($1,$2,'draft',1,1,$3,$3)`,
    [identityId, workerAccountId, NOW]
  );
  await db.query(
    `INSERT INTO worker_identity_versions(
       identity_version_id,identity_id,version_number,parent_version_id,
       version_kind,version_status,created_by_account_id,created_at,submitted_at
     ) VALUES($1,$2,1,NULL,'initial','draft',$3,$4,NULL)`,
    [versionId, identityId, workerAccountId, NOW]
  );
  await db.query(
    `INSERT INTO worker_identity_version_drafts(
       identity_version_id,draft_revision,
       legal_first_name,legal_last_name,previous_legal_name,date_of_birth,
       nationality,country_of_residence,
       verified_email_normalized,email_verified_at,
       verified_phone_e164,phone_verified_at,
       contact_snapshot_at,created_at,updated_at
     ) VALUES(
       $1,1,'Independent','Worker',NULL,'1990-01-01',
       'Pakistani','Pakistan',$2,$3,$4,$3,$3,$3,$3
     )`,
    [versionId, email, NOW, phone]
  );

  const fixtures = [
    {
      purpose: "identity_document",
      fileId: oid("secure_file", "D"),
      bindingId: oid("identity_evidence", "D"),
      jobId: "job_independent_identity_document",
      reservation: "1".repeat(64),
      objectHash: "4".repeat(64),
      contentHash: "7".repeat(64),
      mime: "application/pdf",
      extension: "pdf",
      documentType: "passport",
      documentNumber: "INDEPENDENT-ID-001",
      issueDate: "2025-01-01",
      expiryDate: "2035-01-01"
    },
    {
      purpose: "profile_photo",
      fileId: oid("secure_file", "P"),
      bindingId: oid("identity_evidence", "P"),
      jobId: "job_independent_profile_photo",
      reservation: "2".repeat(64),
      objectHash: "5".repeat(64),
      contentHash: "8".repeat(64),
      mime: "image/png",
      extension: "png",
      documentType: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    },
    {
      purpose: "selfie",
      fileId: oid("secure_file", "S"),
      bindingId: oid("identity_evidence", "S"),
      jobId: "job_independent_selfie",
      reservation: "3".repeat(64),
      objectHash: "6".repeat(64),
      contentHash: "9".repeat(64),
      mime: "image/jpeg",
      extension: "jpg",
      documentType: null,
      documentNumber: null,
      issueDate: null,
      expiryDate: null
    }
  ];

  for (const fixture of fixtures) {
    await db.query(
      `INSERT INTO platform_outbox_jobs(
         job_id,job_type,schema_version,idempotency_key,payload,
         enqueued_by_account_id,enqueued_by_role,status,attempt_count,max_attempts,
         next_attempt_at,succeeded_at,created_at,updated_at
       ) VALUES(
         $1,'secure_file.scan',1,$2,$3::jsonb,$4,'worker',
         'succeeded',1,5,$5,$5,$5,$5
       )`,
      [
        fixture.jobId,
        fixture.contentHash,
        JSON.stringify({ fileRef: fixture.fileId, generation: 1 }),
        workerAccountId,
        NOW
      ]
    );
    await db.query(
      `INSERT INTO platform_secure_files(
         file_id,schema_version,reservation_key,owner_account_id,owner_role,
         tenant_id,membership_id,storage_adapter_key,object_key,display_filename,
         lifecycle_status,file_extension,declared_mime,detected_mime,byte_size,
         content_sha256,quarantined_at,available_at,created_at,updated_at,
         scan_generation,scan_job_id,scan_result_code,scan_completed_at
       ) VALUES(
         $1,1,$2,$3,'worker',NULL,NULL,'local_test',$4,$5,
         'available',$6,$7,$7,128,$8,$9,$9,$9,$9,
         1,$10,'clean',$9
       )`,
      [
        fixture.fileId,
        fixture.reservation,
        workerAccountId,
        `secure-files/${fixture.objectHash}`,
        `identity-${fixture.purpose}.${fixture.extension}`,
        fixture.extension,
        fixture.mime,
        fixture.contentHash,
        NOW,
        fixture.jobId
      ]
    );
    await db.query(
      `INSERT INTO worker_identity_evidence_bindings(
         binding_id,identity_version_id,worker_account_id,purpose,secure_file_id,
         document_type,document_number,issue_date,expiry_date,binding_status,
         supersedes_binding_id,created_by_account_id,created_at
       ) VALUES(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,'active',NULL,$3,$10
       )`,
      [
        fixture.bindingId,
        versionId,
        workerAccountId,
        fixture.purpose,
        fixture.fileId,
        fixture.documentType,
        fixture.documentNumber,
        fixture.issueDate,
        fixture.expiryDate,
        NOW
      ]
    );
  }

  await db.query(
    `UPDATE worker_identity_versions
        SET version_status='submitted',submitted_at=$2
      WHERE identity_version_id=$1`,
    [versionId, NOW]
  );
  for (const [status, lockVersion] of [
    ["submitted", 2],
    ["automated_checks", 3],
    ["manual_review", 4]
  ]) {
    await db.query(
      `UPDATE worker_identities
          SET lifecycle_status=$2,lock_version=$3,updated_at=$4
        WHERE identity_id=$1`,
      [identityId, status, lockVersion, NOW]
    );
  }
  return { identityId, versionId };
}
