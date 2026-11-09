-- Refuse a destructive downgrade while independently reviewed scores exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM written_score_reviews WHERE decision='ADDITIONAL_REVIEW') THEN
    RAISE EXCEPTION 'Retained additional written review decisions require controlled migration before downgrade.';
  END IF;
END $$;
ALTER TABLE written_score_reviews DROP CONSTRAINT written_score_reviews_decision_check;
ALTER TABLE written_score_reviews ADD CONSTRAINT written_score_reviews_decision_check
  CHECK (decision IN ('PASS','FAIL','CHANGES_REQUESTED'));
