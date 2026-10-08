LOCK TABLE interview_requests,platform_audit_events,assurance_action_items IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key='interview.replacement.requested')
 OR EXISTS(SELECT 1 FROM interview_requests WHERE replaces_interview_request_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Retained interview replacement history prevents rollback';END IF;
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check '||platform_interview_replacement_original_check();
END;$$;
DROP FUNCTION platform_interview_replacement_original_check();
ALTER TABLE assurance_action_items DROP CONSTRAINT assurance_action_items_deep_link_check;
DO $$ BEGIN
 EXECUTE 'ALTER TABLE assurance_action_items ADD CONSTRAINT assurance_action_items_deep_link_check '||interview_replacement_original_destination_check();
END; $$;
DROP FUNCTION interview_replacement_original_destination_check();
ALTER TABLE interview_requests DROP CONSTRAINT interview_replacement_same_case,DROP CONSTRAINT interview_replacement_scope,DROP CONSTRAINT interview_single_replacement,DROP CONSTRAINT interview_replacement_is_distinct,DROP COLUMN replaces_interview_request_id;
