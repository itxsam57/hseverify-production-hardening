ALTER TABLE written_score_reviews ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0 CHECK(draft_revision>=0);
ALTER TABLE written_score_rubric_marks ADD COLUMN mark_reason TEXT NULL CHECK(mark_reason IS NULL OR char_length(trim(mark_reason)) BETWEEN 5 AND 4000);
ALTER TABLE written_score_rubric_marks ADD COLUMN mark_sequence BIGINT GENERATED ALWAYS AS IDENTITY;
-- Finalized scores and criterion evidence remain immutable; amendments link retained versions.
CREATE TABLE written_score_amendments (
 amendment_id TEXT PRIMARY KEY CHECK(amendment_id ~ '^score_amendment_[A-Za-z0-9_-]{24}$'),
 original_review_id TEXT NOT NULL UNIQUE REFERENCES written_score_reviews(review_id) ON DELETE RESTRICT,
 replacement_review_id TEXT NOT NULL UNIQUE REFERENCES written_score_reviews(review_id) ON DELETE RESTRICT,
 reviewer_account_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(char_length(trim(reason)) BETWEEN 5 AND 4000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(original_review_id<>replacement_review_id)
);
CREATE FUNCTION hse_written_score_final_locked() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('FINAL','SUPERSEDED') THEN
  IF TG_OP='UPDATE' AND OLD.status='FINAL' AND NEW.status='SUPERSEDED'
    AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Finalized written score evidence is immutable.' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER written_score_final_locked BEFORE UPDATE OR DELETE ON written_score_reviews FOR EACH ROW EXECUTE FUNCTION hse_written_score_final_locked();
CREATE FUNCTION hse_written_rubric_draft_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r written_score_reviews%ROWTYPE; parent_id TEXT;
BEGIN
 parent_id:=CASE WHEN TG_OP='DELETE' THEN OLD.review_id ELSE NEW.review_id END;
 SELECT * INTO r FROM written_score_reviews WHERE review_id=parent_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'DRAFT' THEN RAISE EXCEPTION 'Rubric evidence is locked outside an assigned draft review.' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' AND (NEW.review_id<>OLD.review_id OR NEW.reviewer_account_id<>OLD.reviewer_account_id) THEN
  RAISE EXCEPTION 'Rubric evidence cannot change owner or review.' USING ERRCODE='55000'; END IF;
 IF TG_OP<>'DELETE' AND r.reviewer_account_id<>NEW.reviewer_account_id THEN RAISE EXCEPTION 'Rubric evidence owner differs from review.' USING ERRCODE='55000'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER written_rubric_draft_only BEFORE INSERT OR UPDATE OR DELETE ON written_score_rubric_marks FOR EACH ROW EXECUTE FUNCTION hse_written_rubric_draft_only();
CREATE FUNCTION hse_written_amendment_history_locked() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Written scoring amendment history is append-only.' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER written_amendment_history_locked BEFORE UPDATE OR DELETE ON written_score_amendments FOR EACH ROW EXECUTE FUNCTION hse_written_amendment_history_locked();
