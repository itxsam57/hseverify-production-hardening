DO $$
DECLARE saved JSONB; item JSONB;
BEGIN
 IF EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE job_type IN ('notification.assurance.event','email.assurance.event'))
  OR EXISTS(SELECT 1 FROM platform_notifications WHERE notification_type IN ('evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated'))
  OR EXISTS(SELECT 1 FROM platform_email_deliveries WHERE delivery_type IN ('evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated','assessment.funding.requested','assessment.funding.approved'))
 THEN RAISE EXCEPTION 'Cannot roll back retained assurance notification and delivery history'; END IF;
 saved:=platform_assurance_event_rollback_contract();
 DROP TRIGGER platform_capture_evidence_submission ON platform_audit_events;
 DROP TRIGGER platform_capture_evidence_review ON evidence_review_decisions;
 DROP TRIGGER platform_capture_decision ON assurance_case_timeline_events;
 DROP TRIGGER platform_capture_credential ON credential_issuance_events;
 DROP TRIGGER platform_capture_appeal ON credential_appeal_events;
 DROP TRIGGER platform_capture_evidence_queue ON evidence_review_tasks;
 DROP TRIGGER platform_assurance_event_jobs_validate_insert ON platform_outbox_jobs;
 DROP TRIGGER platform_assurance_event_jobs_guard_update ON platform_outbox_jobs;
 DROP TRIGGER platform_assurance_notifications_validate_insert ON platform_notifications;
 DROP TRIGGER platform_assurance_emails_validate_insert ON platform_email_deliveries;
 DROP TRIGGER platform_assurance_emails_guard_update ON platform_email_deliveries;
 DROP TRIGGER platform_notifications_validate_insert ON platform_notifications;
 DROP TRIGGER platform_email_deliveries_validate_insert ON platform_email_deliveries;
 DROP TRIGGER platform_email_deliveries_guard_update ON platform_email_deliveries;
 DROP INDEX platform_notifications_assurance_source_recipient_idx;
 DROP INDEX platform_notifications_legacy_source_job_idx;
 EXECUTE saved->>'legacyIndex';
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'triggers') LOOP EXECUTE item->>'definition'; END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'functions') LOOP EXECUTE item->>'definition'; END LOOP;
 FOR item IN SELECT * FROM jsonb_array_elements(saved->'checks')
 LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item->>'table',item->>'constraint');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',item->>'table',item->>'constraint',item->>'definition');
 END LOOP;
END;$$;
DROP FUNCTION platform_capture_assurance_event();
DROP FUNCTION platform_enqueue_assurance_event_notifications(TEXT,TEXT);
DROP FUNCTION platform_project_assurance_event_notification(TEXT);
DROP FUNCTION platform_assurance_event_validate_projection();
DROP FUNCTION platform_assurance_email_validate_insert();
DROP FUNCTION platform_assurance_email_guard_update();
DROP FUNCTION platform_assurance_event_job_guard();
DROP FUNCTION platform_assurance_event_assert_job(platform_outbox_jobs);
DROP FUNCTION platform_assurance_event_recipients(TEXT,TEXT);
DROP FUNCTION platform_assurance_event_source(TEXT,TEXT);
DROP FUNCTION platform_assurance_notification_title(TEXT);
DROP FUNCTION platform_assurance_event_rollback_contract();
