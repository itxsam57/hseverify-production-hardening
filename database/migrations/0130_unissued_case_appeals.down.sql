DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM assurance_case_appeals LIMIT 1) THEN
  RAISE EXCEPTION 'Case appeal histories must be retained' USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE assurance_case_appeal_events;
DROP TABLE assurance_case_appeals;
DROP FUNCTION retain_case_appeal_events();
DROP FUNCTION guard_case_appeal_source();
DROP FUNCTION guard_case_appeal_update();
