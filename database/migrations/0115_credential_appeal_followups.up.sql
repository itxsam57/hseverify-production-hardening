CREATE TABLE credential_appeal_followup_events (
 event_id TEXT PRIMARY KEY,
 appeal_id TEXT NOT NULL REFERENCES credential_appeals(appeal_id),
 appeal_version INTEGER NOT NULL CHECK (appeal_version>1),
 event_type TEXT NOT NULL CHECK (event_type IN ('requested','evidence_submitted','interview_submitted')),
 request_id TEXT NULL REFERENCES credential_appeal_followup_events(event_id),
 kind TEXT NOT NULL CHECK (kind IN ('evidence','interview')),
 actor_account_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 4000),
 evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence)='array'),
 interview_request_id TEXT NULL,
 recommendation TEXT NULL CHECK (recommendation IS NULL OR recommendation IN ('PASS','CONDITIONAL_PASS','ADDITIONAL_EVIDENCE_REQUIRED','REASSESSMENT_REQUIRED','SECOND_INTERVIEW_REQUIRED','FAIL')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(appeal_id,appeal_version),
 CHECK ((event_type='requested' AND request_id IS NULL AND recommendation IS NULL AND evidence='[]'::jsonb AND ((kind='interview' AND interview_request_id IS NOT NULL) OR (kind='evidence' AND interview_request_id IS NULL))) OR
        (event_type='evidence_submitted' AND request_id IS NOT NULL AND kind='evidence' AND interview_request_id IS NULL AND recommendation IS NULL AND jsonb_array_length(evidence)>0) OR
        (event_type='interview_submitted' AND request_id IS NOT NULL AND kind='interview' AND interview_request_id IS NOT NULL AND recommendation IS NOT NULL AND evidence='[]'::jsonb))
);
CREATE UNIQUE INDEX credential_appeal_followup_one_response ON credential_appeal_followup_events(request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX credential_appeal_followup_interview_link ON credential_appeal_followup_events(interview_request_id) WHERE event_type='requested' AND kind='interview';
CREATE FUNCTION hse_appeal_followup_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Appeal followup events are append-only'; END; $$;
CREATE TRIGGER credential_appeal_followup_append_only BEFORE UPDATE OR DELETE ON credential_appeal_followup_events FOR EACH ROW EXECUTE FUNCTION hse_appeal_followup_append_only();
CREATE FUNCTION hse_appeal_followup_terminal_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('accepted','rejected') AND EXISTS (
  SELECT 1 FROM credential_appeal_followup_events request
  WHERE request.appeal_id=NEW.appeal_id AND request.event_type='requested'
   AND NOT EXISTS(SELECT 1 FROM credential_appeal_followup_events response WHERE response.request_id=request.event_id)
 ) THEN RAISE EXCEPTION 'Required appeal followup is unresolved'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER credential_appeal_followup_terminal_guard BEFORE UPDATE OF status ON credential_appeals FOR EACH ROW EXECUTE FUNCTION hse_appeal_followup_terminal_guard();
