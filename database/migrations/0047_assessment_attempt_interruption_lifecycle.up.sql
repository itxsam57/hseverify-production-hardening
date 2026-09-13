-- M2.08 interruption lifecycle support.
-- Keeps the assessment attempt recoverable without changing committed answers.

ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_status_check;

ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_check;

ALTER TABLE assessment_attempts
  ADD CONSTRAINT assessment_attempts_status_check CHECK (
    status IN ('IN_PROGRESS', 'INTERRUPTED', 'SUBMITTED')
  );

ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_completion_state_check;

ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_check1;

ALTER TABLE assessment_attempts
  ADD CONSTRAINT assessment_attempts_completion_state_check CHECK (
    (status IN ('IN_PROGRESS', 'INTERRUPTED') AND submitted_at IS NULL) OR
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND current_position = question_count)
  );
