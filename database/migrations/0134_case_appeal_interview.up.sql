CREATE TABLE assurance_case_appeal_interview_requests (
 appeal_id TEXT NOT NULL REFERENCES assurance_case_appeals(appeal_id),
 appeal_version INTEGER NOT NULL CHECK(appeal_version>1),
 interview_request_id TEXT PRIMARY KEY REFERENCES interview_requests(interview_request_id),
 requested_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 4000),
 created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(appeal_id,appeal_version)
);
CREATE INDEX case_appeal_interview_appeal_idx ON assurance_case_appeal_interview_requests(appeal_id,created_at);
CREATE TABLE assurance_case_appeal_interview_outcomes (
 interview_request_id TEXT PRIMARY KEY REFERENCES assurance_case_appeal_interview_requests(interview_request_id),
 appeal_id TEXT NOT NULL REFERENCES assurance_case_appeals(appeal_id),
 appeal_version INTEGER NOT NULL CHECK(appeal_version>2),
 recommendation_event_id TEXT NOT NULL UNIQUE REFERENCES interview_recommendation_events(event_id),
 assessor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 recommendation TEXT NOT NULL CHECK(recommendation IN ('PASS','CONDITIONAL_PASS','ADDITIONAL_EVIDENCE_REQUIRED','REASSESSMENT_REQUIRED','SECOND_INTERVIEW_REQUIRED','FAIL')),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 4000),
 created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(appeal_id,appeal_version)
);
CREATE FUNCTION guard_case_appeal_interview_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Case appeal interview history is immutable' USING ERRCODE='55000';END $$;
CREATE TRIGGER case_appeal_interview_req_immutable BEFORE UPDATE OR DELETE ON assurance_case_appeal_interview_requests
 FOR EACH ROW EXECUTE FUNCTION guard_case_appeal_interview_history();
CREATE TRIGGER case_appeal_interview_outcome_immutable BEFORE UPDATE OR DELETE ON assurance_case_appeal_interview_outcomes
 FOR EACH ROW EXECUTE FUNCTION guard_case_appeal_interview_history();
CREATE FUNCTION guard_case_appeal_interview_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM assurance_case_appeals appeal JOIN assurance_cases cases ON cases.case_id=appeal.case_id
   AND cases.tenant_id=appeal.tenant_id AND cases.worker_account_id=appeal.worker_account_id
  JOIN interview_requests interview ON interview.interview_request_id=NEW.interview_request_id
    AND interview.case_id=cases.case_id AND interview.tenant_id=cases.tenant_id
    AND interview.worker_account_id=cases.worker_account_id
  JOIN platform_decisions decision ON decision.decision_id=appeal.decision_id
    AND decision.case_id=cases.case_id AND decision.tenant_id=cases.tenant_id
  JOIN assurance_case_appeal_events event ON event.appeal_id=appeal.appeal_id AND event.version=NEW.appeal_version
    AND event.status='under_review' AND event.actor_account_id=NEW.requested_by_account_id
  WHERE appeal.appeal_id=NEW.appeal_id AND appeal.status='under_review'
   AND appeal.version=NEW.appeal_version AND appeal.reviewer_account_id=NEW.requested_by_account_id
   AND cases.case_status='Rejected' AND cases.credential_reference IS NULL
   AND cases.decision_reference=appeal.decision_id AND decision.state='REJECTED'
 ) THEN RAISE EXCEPTION 'Case appeal interview request source is invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_appeal_interview_request_guard BEFORE INSERT ON assurance_case_appeal_interview_requests
 FOR EACH ROW EXECUTE FUNCTION guard_case_appeal_interview_request();
CREATE FUNCTION guard_case_appeal_interview_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
 SELECT 1 FROM assurance_case_appeal_interview_requests request
 JOIN assurance_case_appeals appeal ON appeal.appeal_id=request.appeal_id
 JOIN assurance_case_appeal_events event ON event.appeal_id=appeal.appeal_id AND event.version=NEW.appeal_version
  AND event.status='under_review' AND event.actor_account_id=NEW.assessor_account_id
 JOIN interview_recommendation_events recommendation ON recommendation.event_id=NEW.recommendation_event_id
 JOIN interview_requests interview ON interview.interview_request_id=recommendation.interview_request_id
  AND interview.status='COMPLETED' AND interview.assessor_account_id=NEW.assessor_account_id
 JOIN assurance_cases cases ON cases.case_id=appeal.case_id AND cases.tenant_id=appeal.tenant_id
 WHERE request.interview_request_id=NEW.interview_request_id AND request.appeal_id=NEW.appeal_id
  AND appeal.status='under_review' AND appeal.version=NEW.appeal_version
  AND cases.case_status='Rejected' AND cases.decision_reference=appeal.decision_id
  AND cases.credential_reference IS NULL AND recommendation.case_id=cases.case_id
  AND recommendation.tenant_id=cases.tenant_id AND recommendation.assessor_account_id=NEW.assessor_account_id
  AND recommendation.recommendation=NEW.recommendation AND interview.case_id=cases.case_id
  AND interview.worker_account_id=cases.worker_account_id
  AND EXISTS (WITH RECURSIVE lineage AS (
   SELECT interview_request_id,replaces_interview_request_id FROM interview_requests
    WHERE interview_request_id=interview.interview_request_id
   UNION ALL
   SELECT parent.interview_request_id,parent.replaces_interview_request_id FROM interview_requests parent
    JOIN lineage child ON child.replaces_interview_request_id=parent.interview_request_id
  ) SELECT 1 FROM lineage WHERE interview_request_id=request.interview_request_id)
  AND NOT EXISTS(SELECT 1 FROM interview_requests replacement
      WHERE replacement.replaces_interview_request_id=interview.interview_request_id)
 ) THEN RAISE EXCEPTION 'Case appeal interview outcome source is invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_appeal_interview_outcome_guard BEFORE INSERT ON assurance_case_appeal_interview_outcomes
 FOR EACH ROW EXECUTE FUNCTION guard_case_appeal_interview_outcome();
CREATE FUNCTION guard_case_appeal_pending_interviews() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('accepted','rejected') AND EXISTS (
 SELECT 1 FROM assurance_case_appeal_interview_requests request WHERE request.appeal_id=NEW.appeal_id
 AND NOT EXISTS (SELECT 1 FROM assurance_case_appeal_interview_outcomes outcome
 WHERE outcome.interview_request_id=request.interview_request_id)
 ) THEN RAISE EXCEPTION 'Unresolved case appeal interview request' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_appeal_pending_interview_guard BEFORE UPDATE OF status ON assurance_case_appeals
 FOR EACH ROW EXECUTE FUNCTION guard_case_appeal_pending_interviews();