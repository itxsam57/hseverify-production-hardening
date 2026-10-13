DO $$ BEGIN IF EXISTS(SELECT 1 FROM credential_appeal_followup_events) THEN RAISE EXCEPTION 'Populated appeal followup history cannot be rolled back'; END IF; END; $$;
DROP TRIGGER credential_appeal_followup_terminal_guard ON credential_appeals;
DROP FUNCTION hse_appeal_followup_terminal_guard();
DROP TABLE credential_appeal_followup_events;
DROP FUNCTION hse_appeal_followup_append_only();
