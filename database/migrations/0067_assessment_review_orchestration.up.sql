-- Connect assessment submission to truthful human review without fabricating a draft score.
ALTER TABLE written_score_reviews
  ALTER COLUMN score DROP NOT NULL,
  ALTER COLUMN decision DROP NOT NULL;

ALTER TABLE written_score_reviews
  DROP CONSTRAINT IF EXISTS written_score_reviews_completion_check;
ALTER TABLE written_score_reviews
  ADD CONSTRAINT written_score_reviews_completion_check CHECK (
    status = 'DRAFT'
    OR (score IS NOT NULL AND decision IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS written_score_reviews_attempt_draft_idx
  ON written_score_reviews(attempt_id)
  WHERE status='DRAFT';
