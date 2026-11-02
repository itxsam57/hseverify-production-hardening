DO $$ BEGIN IF to_regclass('evidence_review_resolution_events') IS NOT NULL THEN RAISE EXCEPTION 'Newer review resolution contract depends on draft audit history.' USING ERRCODE='55000'; END IF; END $$;
LOCK TABLE evidence_review_draft_revisions,platform_audit_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM evidence_review_draft_revisions) OR EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key='verification.draft.saved') THEN RAISE EXCEPTION 'Reviewer draft history must be retained.' USING ERRCODE='55000'; END IF; END $$;
DROP TABLE evidence_review_draft_revisions;
DROP FUNCTION hse_review_draft_immutable();
DO $$ BEGIN
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check '||hse_review_draft_rollback_constraint();
END $$;
DROP FUNCTION hse_review_draft_rollback_constraint();
