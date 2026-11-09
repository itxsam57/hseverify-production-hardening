DO $$
DECLARE original JSONB; item JSONB;
BEGIN
 IF EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE job_type='notification.assessment.funding')
  OR EXISTS(SELECT 1 FROM platform_notifications WHERE notification_type IN ('assessment.funding.requested','assessment.funding.approved'))
 THEN RAISE EXCEPTION 'Retained assessment funding notification history prevents rollback' USING ERRCODE='55000'; END IF;
 original:=platform_assessment_funding_notification_rollback_contract();
 DROP TRIGGER platform_assessment_funding_notifications_validate_insert ON platform_notifications;
 DROP TRIGGER platform_notifications_validate_insert ON platform_notifications;
 EXECUTE original->>'trigger';
 DROP INDEX platform_notifications_funding_source_recipient_idx;
 DROP INDEX platform_notifications_legacy_source_job_idx;
 EXECUTE 'ALTER TABLE platform_notifications ADD CONSTRAINT platform_notifications_source_job_id_key '||(original->>'sourceUnique');
 FOR item IN SELECT * FROM jsonb_array_elements(original->'checks')
 LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item->>'table',item->>'constraint');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',item->>'table',item->>'constraint',item->>'definition');
 END LOOP;
END;
$$;
DROP TRIGGER platform_assessment_funding_jobs_validate_insert ON platform_outbox_jobs;
DROP TRIGGER platform_assessment_funding_jobs_guard_update ON platform_outbox_jobs;
DROP FUNCTION platform_project_assessment_funding_notification(TEXT);
DROP FUNCTION platform_assessment_funding_notification_validate_projection();
DROP FUNCTION platform_enqueue_assessment_funding_notification(TEXT);
DROP FUNCTION platform_assessment_funding_job_guard();
DROP FUNCTION platform_assessment_funding_assert_job(platform_outbox_jobs);
DROP FUNCTION platform_assessment_funding_notification_recipients(TEXT);
DROP FUNCTION platform_assessment_funding_notification_source(TEXT);
DROP FUNCTION platform_assessment_funding_notification_rollback_contract();
