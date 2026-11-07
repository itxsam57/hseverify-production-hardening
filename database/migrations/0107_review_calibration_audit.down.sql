
DO $$ BEGIN
 LOCK TABLE platform_audit_events IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key IN ('evidence_review.framework.bound','staff.calibration.recorded','framework.revision.recorded')) THEN RAISE EXCEPTION 'Retained calibration audit prevents rollback.' USING ERRCODE='55000'; END IF;
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check ' || hse_review_calibration_original_audit_check();
END; $$;
DROP FUNCTION hse_review_calibration_original_audit_check();
