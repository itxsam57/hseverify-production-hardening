LOCK TABLE interview_requests,platform_audit_events,platform_outbox_jobs,platform_notifications IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key IN
  ('interview.scheduled','notification.interview.intent.recorded','notification.interview.enqueue.deferred','notification.interview.suppressed'))
  OR EXISTS(SELECT 1 FROM platform_notifications WHERE notification_type='interview.scheduled')
  OR EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE job_type='notification.interview.scheduled') THEN
  RAISE EXCEPTION 'Retained interview notification history prevents rollback';
 END IF;
END; $$;
DROP TRIGGER platform_interview_notifications_validate_insert ON platform_notifications;
DROP TRIGGER platform_notifications_validate_insert ON platform_notifications;
CREATE TRIGGER platform_notifications_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW EXECUTE FUNCTION platform_notification_validate_projection();
DROP FUNCTION platform_project_interview_notification(TEXT);
DROP FUNCTION platform_interview_notification_validate_projection();
DROP FUNCTION platform_enqueue_interview_notifications(TEXT);
DROP FUNCTION platform_interview_notification_recipients(TEXT);
DROP INDEX platform_interview_notification_audit_idx;
ALTER TABLE interview_requests DROP COLUMN schedule_event_id;

DO $$
DECLARE original RECORD;
BEGIN
 FOR original IN SELECT * FROM jsonb_to_recordset(platform_interview_notification_rollback_constraints())
  AS definitions("table" TEXT,"constraint" TEXT,definition TEXT)
 LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',original."table",original."constraint");
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',original."table",original."constraint",original.definition);
 END LOOP;
END;
$$;
DROP FUNCTION platform_interview_notification_rollback_constraints();
