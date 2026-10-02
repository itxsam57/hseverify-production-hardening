DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM credential_appeals
     WHERE reviewer_account_id IS NOT NULL
        OR review_reason IS NOT NULL
        OR outcome_action IS NOT NULL
        OR reviewed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove credential appeal review history after reviewed appeals exist.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS credential_appeal_events_append_only ON credential_appeal_events;
DROP FUNCTION IF EXISTS hse_credential_appeal_event_append_only();
DROP INDEX IF EXISTS credential_appeals_one_open_per_credential;

ALTER TABLE credential_appeal_events
  DROP CONSTRAINT IF EXISTS credential_appeal_events_outcome_action_check,
  DROP COLUMN IF EXISTS reviewer_account_id,
  DROP COLUMN IF EXISTS review_reason,
  DROP COLUMN IF EXISTS outcome_action;

ALTER TABLE credential_appeals
  DROP CONSTRAINT IF EXISTS credential_appeals_outcome_action_check,
  DROP COLUMN IF EXISTS reviewer_account_id,
  DROP COLUMN IF EXISTS review_reason,
  DROP COLUMN IF EXISTS outcome_action,
  DROP COLUMN IF EXISTS reviewed_at;