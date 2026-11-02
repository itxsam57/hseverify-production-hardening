DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM written_score_amendments) THEN RAISE EXCEPTION 'Cannot roll back populated written scoring amendment history.'; END IF;
END $$;
DROP TRIGGER written_amendment_history_locked ON written_score_amendments;
DROP FUNCTION hse_written_amendment_history_locked();
DROP TABLE written_score_amendments;
DROP TRIGGER written_rubric_draft_only ON written_score_rubric_marks;
DROP FUNCTION hse_written_rubric_draft_only();
DROP TRIGGER written_score_final_locked ON written_score_reviews;
DROP FUNCTION hse_written_score_final_locked();
ALTER TABLE written_score_rubric_marks DROP COLUMN mark_sequence;
ALTER TABLE written_score_rubric_marks DROP COLUMN mark_reason;
ALTER TABLE written_score_reviews DROP COLUMN draft_revision;
