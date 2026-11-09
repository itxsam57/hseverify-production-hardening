-- Preserve the evidence trail of approved mandatory, randomized and follow-up questions.
-- New question-set versions are INSERT-only; earlier versions must never be changed.
CREATE OR REPLACE FUNCTION hse_interview_playbook_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Interview question set history is append-only.' USING ERRCODE='55000';
END; $$;

DROP TRIGGER IF EXISTS interview_question_sets_append_only ON interview_question_sets;
CREATE TRIGGER interview_question_sets_append_only
BEFORE UPDATE OR DELETE ON interview_question_sets
FOR EACH ROW EXECUTE FUNCTION hse_interview_playbook_append_only();
