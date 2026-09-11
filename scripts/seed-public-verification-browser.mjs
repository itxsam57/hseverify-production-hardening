import { PGlite } from "@electric-sql/pglite";

const dataDirectory = process.env.HSE_PGLITE_DATA_DIR;
if (!dataDirectory) throw new Error("HSE_PGLITE_DATA_DIR is required for public-verification browser seeding.");

export const PUBLIC_CONCERN_WORKER_ID = "worker_id_PublicConcernFixture0001";
const accountId = "account_public_concern_browser_worker";
const identityId = "worker_identity_PublicConcernIdentity001";
const versionId = "identity_version_PublicConcernVersion0001";
const email = "public.concern.browser@example.test";
const phone = "+966500000091";
const verifiedAt = "2026-08-31T00:00:00.000Z";

function token24(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, "x").padEnd(24, "x").slice(0, 24);
}

function hex64(value) {
  return value.toString(16).padStart(64, "0").slice(-64);
}

async function seedAvailableFile(database, label, mime, counter) {
  const fileId = `secure_file_${token24(`concern-${label}`)}`;
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const jobId = `job_${token24(`concern-scan-${label}`)}`;

  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL, 'local_test', $4, $5)`,
    [fileId, hex64(counter * 10 + 1), accountId, `secure-files/${hex64(counter * 10 + 2)}`, `${label}.${extension}`]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined', file_extension = $2,
         declared_mime = $3, detected_mime = $3, byte_size = 256,
         content_sha256 = $4
     WHERE file_id = $1`,
    [fileId, extension, mime, hex64(counter * 10 + 3)]
  );
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb, $4, 'worker', NULL, NULL)`,
    [jobId, hex64(counter * 10 + 4), JSON.stringify({ fileRef: fileId, generation: 1 }), accountId]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'scan_pending', scan_generation = 1, scan_job_id = $2
     WHERE file_id = $1`,
    [fileId, jobId]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'available', scan_result_code = 'clean'
     WHERE file_id = $1`,
    [fileId]
  );
  return fileId;
}

const database = await PGlite.create(dataDirectory);
try {
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'Public Concern Browser Worker', 'active', $4, $4, $4, $4)`,
    [accountId, email, phone, verifiedAt]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, verifiedAt]
  );
  await database.query(
    `INSERT INTO worker_identities (
       identity_id, worker_account_id, schema_version,
       lifecycle_status, current_version_number, lock_version
     ) VALUES ($1, $2, 1, 'draft', 1, 1)`,
    [identityId, accountId]
  );
  await database.query(
    `INSERT INTO worker_identity_versions (
       identity_version_id, identity_id, version_number,
       parent_version_id, version_kind, version_status, created_by_account_id
     ) VALUES ($1, $2, 1, NULL, 'initial', 'draft', $3)`,
    [versionId, identityId, accountId]
  );
  await database.query(
    `INSERT INTO worker_identity_version_drafts (
       identity_version_id, draft_revision,
       legal_first_name, legal_last_name, previous_legal_name,
       date_of_birth, nationality, country_of_residence,
       verified_email_normalized, email_verified_at,
       verified_phone_e164, phone_verified_at
     ) VALUES ($1, 1, 'Public', 'Concern', NULL, '1992-03-04',
               'Test nationality', 'Test residence', $2, $3, $4, $3)`,
    [versionId, email, verifiedAt, phone]
  );

  const documentFile = await seedAvailableFile(database, "identity-document", "application/pdf", 91);
  const photoFile = await seedAvailableFile(database, "profile-photo", "image/jpeg", 92);
  const selfieFile = await seedAvailableFile(database, "selfie", "image/png", 93);

  await database.query(
    `INSERT INTO worker_identity_evidence_bindings (
       binding_id, identity_version_id, worker_account_id, purpose, secure_file_id,
       document_type, document_number, issue_date, expiry_date, created_by_account_id
     ) VALUES
       ($1, $4, $5, 'identity_document', $6, 'passport', 'PUBLIC-CONCERN-QA-001', '2025-01-01', '2035-01-01', $5),
       ($2, $4, $5, 'profile_photo', $7, NULL, NULL, NULL, NULL, $5),
       ($3, $4, $5, 'selfie', $8, NULL, NULL, NULL, NULL, $5)`,
    [
      `identity_evidence_${token24("concern-document")}`,
      `identity_evidence_${token24("concern-profile-photo")}`,
      `identity_evidence_${token24("concern-selfie")}`,
      versionId,
      accountId,
      documentFile,
      photoFile,
      selfieFile
    ]
  );

  await database.query(
    `UPDATE worker_identity_versions
     SET version_status = 'submitted', submitted_at = CURRENT_TIMESTAMP
     WHERE identity_version_id = $1`,
    [versionId]
  );
  for (const status of ["submitted", "automated_checks", "manual_review", "verified"]) {
    await database.query(
      `UPDATE worker_identities
       SET lifecycle_status = $1, lock_version = lock_version + 1
       WHERE identity_id = $2`,
      [status, identityId]
    );
  }
  await database.query(
    `INSERT INTO worker_identity_duplicate_checks (
       check_id, identity_id, identity_version_id, worker_account_id,
       check_sequence, check_status
     ) VALUES ($1, $2, $3, $4, 1, 'clear')`,
    [`identity_duplicate_check_${token24("public-concern-clear")}`, identityId, versionId, accountId]
  );
  await database.query(
    `INSERT INTO worker_identity_worker_ids (
       permanent_worker_id, identity_id, identity_version_id, worker_account_id
     ) VALUES ($1, $2, $3, $4)`,
    [PUBLIC_CONCERN_WORKER_ID, identityId, versionId, accountId]
  );

  const proof = await database.query(
    `SELECT ids.permanent_worker_id, identities.lifecycle_status, versions.version_status
     FROM worker_identity_worker_ids AS ids
     JOIN worker_identities AS identities ON identities.identity_id = ids.identity_id
     JOIN worker_identity_versions AS versions ON versions.identity_version_id = ids.identity_version_id
     WHERE ids.permanent_worker_id = $1`,
    [PUBLIC_CONCERN_WORKER_ID]
  );
  if (
    proof.rows.length !== 1 ||
    proof.rows[0].lifecycle_status !== "verified" ||
    proof.rows[0].version_status !== "submitted"
  ) {
    throw new Error("Public-verification browser fixture did not reach a verified current Worker-ID state.");
  }
  console.log(`PUBLIC_VERIFICATION_BROWSER_FIXTURE ${PUBLIC_CONCERN_WORKER_ID}`);
} finally {
  await database.close();
}
