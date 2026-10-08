LOCK TABLE interview_requests,platform_audit_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key='interview.availability.updated')
 OR EXISTS(SELECT 1 FROM interview_requests WHERE candidate_available_from IS NOT NULL OR candidate_available_until IS NOT NULL)
 THEN RAISE EXCEPTION 'Retained interview availability history prevents rollback';END IF;
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check '||platform_interview_availability_original_check();
END;$$;
DROP FUNCTION platform_interview_availability_original_check();
ALTER TABLE interview_requests DROP CONSTRAINT interview_candidate_availability_window,
 DROP COLUMN candidate_available_from,DROP COLUMN candidate_available_until;
