ALTER TABLE credential_appeals
  ADD COLUMN IF NOT EXISTS reviewer_account_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS review_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS outcome_action TEXT NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ NULL;

ALTER TABLE credential_appeals
  DROP CONSTRAINT IF EXISTS credential_appeals_outcome_action_check;
ALTER TABLE credential_appeals
  ADD CONSTRAINT credential_appeals_outcome_action_check CHECK (
    outcome_action IS NULL OR outcome_action IN ('none','reassessment','renew','suspend','revoke')
  );

ALTER TABLE credential_appeal_events
  ADD COLUMN IF NOT EXISTS reviewer_account_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS review_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS outcome_action TEXT NULL;

ALTER TABLE credential_appeal_events
  DROP CONSTRAINT IF EXISTS credential_appeal_events_outcome_action_check;
ALTER TABLE credential_appeal_events
  ADD CONSTRAINT credential_appeal_events_outcome_action_check CHECK (
    outcome_action IS NULL OR outcome_action IN ('none','reassessment','renew','suspend','revoke')
  );

CREATE UNIQUE INDEX IF NOT EXISTS credential_appeals_one_open_per_credential
  ON credential_appeals(credential_id)
  WHERE status IN ('submitted','under_review');

CREATE OR REPLACE FUNCTION hse_credential_appeal_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'credential appeal events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS credential_appeal_events_append_only ON credential_appeal_events;
CREATE TRIGGER credential_appeal_events_append_only
BEFORE UPDATE OR DELETE ON credential_appeal_events
FOR EACH ROW EXECUTE FUNCTION hse_credential_appeal_event_append_only();