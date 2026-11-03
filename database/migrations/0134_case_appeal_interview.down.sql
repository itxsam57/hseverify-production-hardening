DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM assurance_case_appeal_interview_requests LIMIT 1) OR EXISTS(SELECT 1 FROM assurance_case_appeal_interview_outcomes LIMIT 1) THEN
 RAISE EXCEPTION 'Case appeal interview history cannot be rolled back' USING ERRCODE='55000';END IF;
END $$;
DROP TRIGGER case_appeal_pending_interview_guard ON assurance_case_appeals;
DROP FUNCTION guard_case_appeal_pending_interviews();
DROP TRIGGER case_appeal_interview_outcome_guard ON assurance_case_appeal_interview_outcomes;
DROP FUNCTION guard_case_appeal_interview_outcome();
DROP TRIGGER case_appeal_interview_request_guard ON assurance_case_appeal_interview_requests;
DROP FUNCTION guard_case_appeal_interview_request();
DROP TRIGGER case_appeal_interview_outcome_immutable ON assurance_case_appeal_interview_outcomes;
DROP TRIGGER case_appeal_interview_req_immutable ON assurance_case_appeal_interview_requests;
DROP FUNCTION guard_case_appeal_interview_history();
DROP TABLE assurance_case_appeal_interview_outcomes;
DROP TABLE assurance_case_appeal_interview_requests;