DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM worker_assessment_reassessment_sources)
 THEN RAISE EXCEPTION 'Cannot roll back retained assessment reassessment source history' USING ERRCODE='55000'; END IF;
END; $$;
DROP TRIGGER worker_assessment_reassessment_case_validate ON worker_assessment_applications;
DROP FUNCTION validate_assessment_reassessment_case_binding();
DROP TRIGGER worker_assessment_reassessment_source_immutable ON worker_assessment_reassessment_sources;
DROP FUNCTION retain_assessment_reassessment_source();
DROP TRIGGER worker_assessment_reassessment_source_validate ON worker_assessment_reassessment_sources;
DROP FUNCTION validate_assessment_reassessment_source();
DROP TABLE worker_assessment_reassessment_sources;
