DO $$
DECLARE previous_expression TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM platform_outbox_jobs WHERE job_type='report.generation') THEN
    RAISE EXCEPTION 'Retained report generation jobs prevent rollback';
  END IF;
  SELECT pg_get_expr(conbin,conrelid) INTO previous_expression FROM pg_constraint
  WHERE conrelid='platform_outbox_jobs'::regclass AND conname='platform_outbox_jobs_job_type_check';
  IF previous_expression IS NULL THEN RAISE EXCEPTION 'Outbox job type authority is missing'; END IF;
  ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_jobs_job_type_check;
  EXECUTE format('ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_jobs_job_type_check CHECK ((%s) AND job_type<>%L)',
    previous_expression,'report.generation');
END; $$;
ALTER TABLE platform_outbox_jobs DROP CONSTRAINT IF EXISTS outbox_report_generation_payload_check;
DROP TRIGGER IF EXISTS report_delivery_provenance_guard ON report_deliveries;
DROP FUNCTION IF EXISTS hse_report_delivery_provenance_guard();
DROP INDEX IF EXISTS report_delivery_requester_idx;
ALTER TABLE report_deliveries
  DROP CONSTRAINT IF EXISTS report_delivery_type_check,
  DROP CONSTRAINT IF EXISTS report_delivery_format_check,
  DROP CONSTRAINT IF EXISTS report_delivery_status_check,
  DROP CONSTRAINT IF EXISTS report_delivery_generation_check,
  DROP CONSTRAINT IF EXISTS report_delivery_scope_check,
  DROP CONSTRAINT IF EXISTS report_delivery_snapshot_check,
  DROP CONSTRAINT IF EXISTS report_delivery_artifact_check,
  DROP COLUMN IF EXISTS report_type,
  DROP COLUMN IF EXISTS requested_by_membership_id,
  DROP COLUMN IF EXISTS requested_at,
  DROP COLUMN IF EXISTS request_scope,
  DROP COLUMN IF EXISTS snapshot_rows,
  DROP COLUMN IF EXISTS generation_job_id,
  DROP COLUMN IF EXISTS generation_version,
  DROP COLUMN IF EXISTS artifact_key,
  DROP COLUMN IF EXISTS artifact_sha256,
  DROP COLUMN IF EXISTS artifact_byte_size,
  DROP COLUMN IF EXISTS artifact_mime_type,
  DROP COLUMN IF EXISTS generated_at,
  DROP COLUMN IF EXISTS last_error_code;
