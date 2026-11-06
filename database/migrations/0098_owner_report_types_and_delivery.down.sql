DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM worker_report_deliveries) OR EXISTS(SELECT 1 FROM report_definitions)
  OR EXISTS(SELECT 1 FROM report_email_deliveries) OR EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE job_type='email.report.ready')
  OR EXISTS(SELECT 1 FROM report_deliveries WHERE report_type<>'workforce-status' OR queue_email OR definition_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Cannot roll back retained report expansion records' USING ERRCODE='55000';
 END IF;
END; $$;
DROP FUNCTION hse_enqueue_report_ready_email(TEXT,TEXT,TEXT);
DROP TRIGGER report_ready_job_insert_guard ON platform_outbox_jobs;
DROP TRIGGER report_ready_job_update_guard ON platform_outbox_jobs;
DROP FUNCTION hse_report_ready_job_guard();
DROP TABLE report_email_deliveries;
DROP FUNCTION hse_report_email_delivery_guard();
DROP FUNCTION hse_report_ready_assert_source(RECORD,platform_outbox_jobs);
DROP FUNCTION hse_report_ready_source(TEXT);
DROP TABLE worker_report_deliveries;
DROP FUNCTION hse_worker_report_provenance_guard();
DROP TRIGGER report_configuration_guard ON report_deliveries;
DROP FUNCTION hse_report_configuration_guard();
ALTER TABLE report_deliveries DROP CONSTRAINT report_delivery_fixed_snapshot,DROP CONSTRAINT report_delivery_source_json,
 DROP CONSTRAINT report_delivery_email_intent,DROP CONSTRAINT report_delivery_definition_fk,DROP CONSTRAINT report_delivery_definition_pair;
ALTER TABLE report_deliveries DROP COLUMN snapshot_headers,DROP COLUMN source_provenance,DROP COLUMN request_filters,
 DROP COLUMN queue_email,DROP COLUMN recipient_address_hash,DROP COLUMN definition_id,DROP COLUMN definition_version;
ALTER TABLE report_deliveries DROP CONSTRAINT report_delivery_type_check;
ALTER TABLE report_deliveries ADD CONSTRAINT report_delivery_type_check CHECK(report_type='workforce-status');
ALTER TABLE report_definitions DROP CONSTRAINT report_definition_current_version_fk;
DROP TABLE report_definition_versions;
DROP TABLE report_definitions;
DROP FUNCTION hse_report_definition_guard();
DROP FUNCTION hse_report_owner_access(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT);
DROP FUNCTION hse_report_snapshot_valid(TEXT,JSONB,JSONB);
DROP FUNCTION hse_report_headers(TEXT);
ALTER TABLE platform_outbox_jobs DROP CONSTRAINT outbox_report_ready_payload_check;
DO $$
DECLARE expression TEXT;
BEGIN
 SELECT job_type_expression INTO expression FROM hse_report_expansion_rollback;
 ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_jobs_job_type_check;
 EXECUTE format('ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_jobs_job_type_check CHECK (%s)',expression);
 SELECT origin_expression INTO expression FROM hse_report_expansion_rollback;
 ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_enqueue_origin;
 EXECUTE format('ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_enqueue_origin CHECK (%s)',expression);
END; $$;
DROP TABLE hse_report_expansion_rollback;
