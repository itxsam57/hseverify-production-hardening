LOCK TABLE interview_requests,platform_audit_events,platform_outbox_jobs,platform_email_deliveries IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key IN('email.interview.intent.recorded','email.interview.enqueue.deferred'))
  OR EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE job_type='email.interview.scheduled')
  OR EXISTS(SELECT 1 FROM platform_email_deliveries WHERE delivery_type='interview.scheduled')
 THEN RAISE EXCEPTION 'Retained interview email history prevents rollback';END IF;
END;$$;
DROP TRIGGER platform_interview_emails_guard_update ON platform_email_deliveries;
DROP TRIGGER platform_email_deliveries_guard_update ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_guard_update BEFORE UPDATE ON platform_email_deliveries
 FOR EACH ROW EXECUTE FUNCTION platform_email_delivery_guard_update();
DROP FUNCTION platform_interview_email_guard_update();
DO $$ DECLARE original JSONB;BEGIN
 FOR original IN SELECT * FROM jsonb_array_elements(platform_interview_email_rollback_functions())
 LOOP EXECUTE original->>'definition';END LOOP;
END;$$;
DROP FUNCTION platform_interview_email_rollback_functions();
DROP TRIGGER platform_interview_emails_validate_insert ON platform_email_deliveries;
DROP TRIGGER platform_email_deliveries_validate_insert ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_validate_insert BEFORE INSERT ON platform_email_deliveries
 FOR EACH ROW EXECUTE FUNCTION platform_email_delivery_validate_insert();
DROP FUNCTION platform_interview_email_validate_insert();
DROP FUNCTION platform_enqueue_interview_emails(TEXT);
DO $$ DECLARE original JSONB;BEGIN
 FOR original IN SELECT * FROM jsonb_array_elements(platform_interview_email_rollback_constraints())
 LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',original->>'table',original->>'constraint');
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',original->>'table',original->>'constraint',original->>'definition');
 END LOOP;
END;$$;
DROP FUNCTION platform_interview_email_rollback_constraints();
