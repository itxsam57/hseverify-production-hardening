DROP INDEX IF EXISTS written_score_reviews_attempt_draft_idx;
ALTER TABLE written_score_reviews
  DROP CONSTRAINT IF EXISTS written_score_reviews_completion_check;
UPDATE written_score_reviews
   SET score=COALESCE(score,0),
       decision=COALESCE(decision,'CHANGES_REQUESTED')
 WHERE status='DRAFT';
ALTER TABLE written_score_reviews
  ALTER COLUMN score SET NOT NULL,
  ALTER COLUMN decision SET NOT NULL;
