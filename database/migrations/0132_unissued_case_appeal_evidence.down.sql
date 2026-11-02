DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM assurance_case_appeal_evidence LIMIT 1) THEN
  RAISE EXCEPTION 'Case appeal evidence snapshots must be retained' USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE assurance_case_appeal_evidence;
DROP FUNCTION retain_case_appeal_evidence();
DROP FUNCTION validate_case_appeal_evidence();
