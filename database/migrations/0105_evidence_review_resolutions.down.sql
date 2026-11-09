DO $$ BEGIN
 IF to_regprocedure('hse_review_calibration_original_audit_check()') IS NOT NULL OR to_regprocedure('platform_review_resolution_notification_rollback_contract()') IS NOT NULL THEN
  RAISE EXCEPTION 'Newer calibration or notification contracts depend on review resolution history.' USING ERRCODE='55000';
 END IF;
END $$;
LOCK TABLE evidence_review_tasks,evidence_review_resolution_events,platform_audit_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM evidence_review_resolution_events) OR EXISTS(SELECT 1 FROM evidence_review_tasks WHERE task_status IN ('UNABLE_TO_VERIFY','ESCALATED')) OR EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key IN ('verification.resolution.recorded','verification.escalation.returned')) THEN RAISE EXCEPTION 'Review resolution history must be retained.' USING ERRCODE='55000'; END IF; END $$;
DO $$ DECLARE original JSONB; BEGIN
 FOR original IN SELECT * FROM jsonb_array_elements(hse_review_resolution_rollback_contract()) LOOP
 EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',original->>'table',original->>'constraint');
 EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',original->>'table',original->>'constraint',original->>'definition');
 END LOOP;
END $$;
DROP TABLE evidence_review_resolution_events;
DROP FUNCTION hse_review_resolution_rollback_contract();
