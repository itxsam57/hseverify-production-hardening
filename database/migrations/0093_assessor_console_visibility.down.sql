-- Never silently discard an explicit retained sharing decision.
LOCK TABLE evidence_review_decisions, written_score_reviews IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM evidence_review_decisions WHERE assessor_visible)
     OR EXISTS (SELECT 1 FROM written_score_reviews WHERE assessor_visible) THEN
    RAISE EXCEPTION 'Assessor-visible reviewer history must be retained; rollback refused.'
      USING ERRCODE='55000';
  END IF;
END;
$$;
ALTER TABLE written_score_reviews DROP COLUMN assessor_visible;
ALTER TABLE evidence_review_decisions DROP COLUMN assessor_visible;
