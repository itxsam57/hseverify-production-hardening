DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM case_replay_access_events LIMIT 1)
     OR EXISTS (SELECT 1 FROM written_scoring_assistance_events LIMIT 1) THEN
    RAISE EXCEPTION 'Cannot roll back Case Replay/scoring assistance history while records exist.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS case_replay_access_events_append_only ON case_replay_access_events;
DROP TABLE IF EXISTS case_replay_access_events;
DROP TRIGGER IF EXISTS written_scoring_assistance_events_append_only
  ON written_scoring_assistance_events;
DROP TABLE IF EXISTS written_scoring_assistance_events;
DROP FUNCTION IF EXISTS hse_masterplan_history_append_only();
