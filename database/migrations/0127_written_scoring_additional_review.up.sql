-- Distinct independent additional-review decision. Preserve frozen original decision history.
ALTER TABLE written_score_reviews DROP CONSTRAINT written_score_reviews_decision_check;
ALTER TABLE written_score_reviews ADD CONSTRAINT written_score_reviews_decision_check
  CHECK (decision IN ('PASS','FAIL','CHANGES_REQUESTED','ADDITIONAL_REVIEW'));
