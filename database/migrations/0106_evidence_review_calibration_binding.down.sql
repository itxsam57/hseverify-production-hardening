-- Refuse erasure of benchmark and task applicability history.

DO $$ BEGIN
 LOCK TABLE evidence_review_framework_bindings,staff_calibrations,assurance_framework_revisions IN ACCESS EXCLUSIVE MODE;
 IF to_regprocedure('hse_review_calibration_original_audit_check()') IS NOT NULL THEN RAISE EXCEPTION 'Roll back calibration audit migration first.' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM evidence_review_framework_bindings) OR EXISTS(SELECT 1 FROM staff_calibrations WHERE framework_version_id IS NOT NULL) OR EXISTS(SELECT 1 FROM assurance_framework_revisions WHERE version_no>1) THEN
  RAISE EXCEPTION 'Retained calibration and review-binding history prevents rollback.' USING ERRCODE='55000';
 END IF;
END; $$;
DROP TRIGGER staff_calibration_append_only ON staff_calibrations;
DROP TABLE evidence_review_framework_bindings;
ALTER TABLE staff_calibrations DROP CONSTRAINT staff_calibration_authoritative_revision_fk, DROP CONSTRAINT staff_calibration_revision_pair;
ALTER TABLE staff_calibrations DROP COLUMN framework_version_id,DROP COLUMN framework_id,DROP COLUMN calibration_sequence;
DROP TRIGGER assurance_framework_initial_revision ON assurance_frameworks;
DROP FUNCTION hse_framework_initial_revision();
DROP TABLE assurance_framework_revisions;
DROP FUNCTION hse_review_calibration_history_append_only();
