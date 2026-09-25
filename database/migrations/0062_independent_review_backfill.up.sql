-- Backfill platform-scoped verification tasks for independent Worker submissions that predate
-- the automatic queue integration. This is intentionally idempotent and keeps submitted
-- evidence visible to Verifiers without requiring a Company Assurance Case.

INSERT INTO evidence_review_tasks (
  task_id,
  tenant_id,
  case_id,
  worker_account_id,
  evidence_kind,
  source_record_id,
  source_version_id,
  secure_file_id,
  evidence_label,
  task_status,
  created_at,
  updated_at
)
SELECT
  'evidence_review_' || substr(md5(
    records.worker_account_id || ':' ||
    records.record_kind || ':' ||
    versions.version_id
  ), 1, 24),
  NULL,
  NULL,
  records.worker_account_id,
  records.record_kind,
  records.record_id,
  versions.version_id,
  COALESCE(attachment.secure_file_id, leaving.secure_file_id),
  records.record_kind || ' evidence',
  'QUEUED',
  COALESCE(versions.submitted_at, versions.updated_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM worker_evidence_records AS records
JOIN worker_evidence_versions AS versions
  ON versions.version_id = records.current_version_id
LEFT JOIN LATERAL (
  SELECT secure_file_id
  FROM worker_evidence_attachments
  WHERE version_id = versions.version_id
    AND superseded_at IS NULL
  ORDER BY
    CASE attachment_kind WHEN 'primary_certificate' THEN 0 ELSE 1 END,
    created_at DESC
  LIMIT 1
) AS attachment ON TRUE
LEFT JOIN LATERAL (
  SELECT secure_file_id
  FROM worker_employment_leaving_letters
  WHERE employment_version_id = versions.version_id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
) AS leaving ON records.record_kind = 'employment'
WHERE records.lifecycle_status <> 'inactive'
  AND versions.version_status = 'submitted'
ON CONFLICT DO NOTHING;

INSERT INTO evidence_review_tasks (
  task_id,
  tenant_id,
  case_id,
  worker_account_id,
  evidence_kind,
  source_record_id,
  source_version_id,
  secure_file_id,
  evidence_label,
  task_status,
  created_at,
  updated_at
)
SELECT
  'evidence_review_' || substr(md5(
    identities.worker_account_id || ':identity:' ||
    versions.identity_version_id
  ), 1, 24),
  NULL,
  NULL,
  identities.worker_account_id,
  'identity',
  identities.identity_id,
  versions.identity_version_id,
  identity_file.secure_file_id,
  'Identity document',
  'QUEUED',
  COALESCE(versions.submitted_at, identities.updated_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
LEFT JOIN LATERAL (
  SELECT secure_file_id
  FROM worker_identity_evidence_bindings
  WHERE identity_version_id = versions.identity_version_id
    AND purpose = 'identity_document'
    AND binding_status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
) AS identity_file ON TRUE
WHERE identities.lifecycle_status = 'manual_review'
  AND versions.version_status = 'submitted'
ON CONFLICT DO NOTHING;
