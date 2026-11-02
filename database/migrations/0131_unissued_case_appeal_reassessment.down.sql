DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM worker_case_appeal_reassessment_sources LIMIT 1) THEN
  RAISE EXCEPTION 'Case appeal reassessment lineage must be retained' USING ERRCODE='55000';
 END IF;
END $$;
DROP TRIGGER case_appeal_reassessment_case_validate ON worker_assessment_applications;
DROP FUNCTION validate_case_appeal_reassessment_binding();
DROP TABLE worker_case_appeal_reassessment_sources;
DROP FUNCTION retain_case_appeal_reassessment_source();
DROP FUNCTION validate_case_appeal_reassessment_source();
