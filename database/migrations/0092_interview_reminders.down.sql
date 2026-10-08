LOCK TABLE interview_requests,platform_audit_events,platform_outbox_jobs,
 platform_outbox_job_attempts,platform_notifications,platform_email_deliveries,
 platform_email_delivery_attempts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE job_type IN ('notification.interview.reminder','email.interview.reminder'))
  OR EXISTS(SELECT 1 FROM platform_notifications WHERE notification_type='interview.reminder')
  OR EXISTS(SELECT 1 FROM platform_email_deliveries WHERE delivery_type='interview.reminder')
  OR EXISTS(SELECT 1 FROM interview_requests WHERE reminder_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM platform_audit_events WHERE
   action_key IN ('notification.interview.reminder.intent.recorded','notification.interview.reminder.enqueue.deferred',
    'email.interview.reminder.intent.recorded','email.interview.reminder.enqueue.deferred')
   OR (action_key='interview.scheduled' AND metadata->>'reminderAt' IS NOT NULL))
 THEN RAISE EXCEPTION 'Retained interview reminder history prevents rollback'; END IF;
END;$$;
DROP TRIGGER platform_interview_reminders_validate_insert ON platform_notifications;
DROP TRIGGER platform_interview_reminder_emails_validate_insert ON platform_email_deliveries;
DROP TRIGGER platform_notifications_validate_insert ON platform_notifications;
DROP TRIGGER platform_email_deliveries_validate_insert ON platform_email_deliveries;
DROP TRIGGER platform_email_deliveries_guard_update ON platform_email_deliveries;
DROP TRIGGER platform_interview_emails_guard_update ON platform_email_deliveries;
DO $$ DECLARE original JSONB;contract JSONB:=platform_interview_reminder_rollback_contract();BEGIN
 FOR original IN SELECT * FROM jsonb_array_elements(contract->'functions')
 LOOP EXECUTE original->>'definition';END LOOP;
 FOR original IN SELECT * FROM jsonb_array_elements(contract->'triggers')
 LOOP EXECUTE original->>'definition';END LOOP;
 FOR original IN SELECT * FROM jsonb_array_elements(contract->'constraints')
 LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',original->>'table',original->>'constraint');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',original->>'table',original->>'constraint',original->>'definition');
 END LOOP;
END;$$;
DROP FUNCTION platform_project_interview_reminder_notification(TEXT);
DROP FUNCTION platform_interview_reminder_validate_projection();
DROP FUNCTION platform_interview_reminder_email_validate_insert();
DROP FUNCTION platform_enqueue_interview_reminder_notifications(TEXT);
DROP FUNCTION platform_enqueue_interview_reminder_emails(TEXT);
DROP FUNCTION platform_interview_reminder_recipients(TEXT);
DROP FUNCTION platform_interview_reminder_rollback_contract();
