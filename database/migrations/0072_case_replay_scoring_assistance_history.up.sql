-- Masterplan completion: privileged Case Replay access history and reviewer AI-guidance history.

CREATE TABLE IF NOT EXISTS written_scoring_assistance_events (
  assistance_id TEXT NOT NULL REFERENCES written_scoring_assistance(assistance_id) ON DELETE RESTRICT,
  event_version INTEGER NOT NULL CHECK (event_version > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('GENERATED','ACCEPTED_AS_GUIDANCE','REJECTED','STALE')),
  actor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  reason TEXT NULL CHECK (reason IS NULL OR char_length(trim(reason)) BETWEEN 5 AND 2000),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assistance_id,event_version)
);

INSERT INTO written_scoring_assistance_events(
  assistance_id,event_version,event_type,actor_account_id,reason,occurred_at
)
SELECT assistance.assistance_id,1,
       CASE assistance.status
         WHEN 'ACCEPTED_AS_GUIDANCE' THEN 'ACCEPTED_AS_GUIDANCE'
         WHEN 'REJECTED' THEN 'REJECTED'
         WHEN 'STALE' THEN 'STALE'
         ELSE 'GENERATED'
       END,
       COALESCE(assistance.reviewer_account_id, reviews.reviewer_account_id),
       CASE WHEN assistance.status='GENERATED' THEN NULL ELSE assistance.reviewer_reason END,
       COALESCE(assistance.reviewed_at,assistance.generated_at)
  FROM written_scoring_assistance assistance
  JOIN written_score_reviews reviews ON reviews.review_id=assistance.review_id
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS case_replay_access_events (
  replay_event_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  actor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('admin','root')),
  purpose TEXT NOT NULL CHECK (char_length(trim(purpose)) BETWEEN 5 AND 1000),
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS case_replay_access_case_idx
  ON case_replay_access_events(case_id,accessed_at DESC,replay_event_id);

CREATE OR REPLACE FUNCTION hse_masterplan_history_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Masterplan audit history is append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS written_scoring_assistance_events_append_only
  ON written_scoring_assistance_events;
CREATE TRIGGER written_scoring_assistance_events_append_only
BEFORE UPDATE OR DELETE ON written_scoring_assistance_events
FOR EACH ROW EXECUTE FUNCTION hse_masterplan_history_append_only();

DROP TRIGGER IF EXISTS case_replay_access_events_append_only
  ON case_replay_access_events;
CREATE TRIGGER case_replay_access_events_append_only
BEFORE UPDATE OR DELETE ON case_replay_access_events
FOR EACH ROW EXECUTE FUNCTION hse_masterplan_history_append_only();
