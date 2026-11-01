-- Roll back only this guard. Existing question versions are retained unchanged.
DROP TRIGGER IF EXISTS interview_question_sets_append_only ON interview_question_sets;
DROP FUNCTION IF EXISTS hse_interview_playbook_append_only();
