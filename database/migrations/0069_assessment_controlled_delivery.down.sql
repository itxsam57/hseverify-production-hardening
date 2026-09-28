-- Retained generated-form history can contain legitimate replacement generations.
-- Do not reintroduce the old one-form-per-case uniqueness during rollback.

ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_status_check;
ALTER TABLE assessment_attempts
  ADD CONSTRAINT assessment_attempts_status_check CHECK (
    status IN ('IN_PROGRESS','INTERRUPTED','SUBMITTED')
  );
ALTER TABLE assessment_attempts
  DROP CONSTRAINT IF EXISTS assessment_attempts_completion_state_check;
ALTER TABLE assessment_attempts
  ADD CONSTRAINT assessment_attempts_completion_state_check CHECK (
    (status IN ('IN_PROGRESS','INTERRUPTED') AND submitted_at IS NULL) OR
    (status='SUBMITTED' AND submitted_at IS NOT NULL AND current_position=question_count)
  );

DROP TABLE IF EXISTS assessment_section_locks;
DROP TABLE IF EXISTS assessment_answer_revisions;
DROP TABLE IF EXISTS assessment_candidate_flags;
DROP TABLE IF EXISTS assessment_attempt_replacements;
DROP TABLE IF EXISTS assessment_replacement_authorizations;
DROP TABLE IF EXISTS assessment_recovery_reviews;
DROP TABLE IF EXISTS assessment_interruption_events;
DROP TABLE IF EXISTS assessment_attempt_bindings;
DROP TABLE IF EXISTS assessment_precheck_records;
DROP TABLE IF EXISTS assessment_blueprint_delivery_settings;

DROP INDEX IF EXISTS generated_assessment_forms_replacement_idx;
DROP INDEX IF EXISTS generated_assessment_forms_initial_uidx;
DROP INDEX IF EXISTS generated_assessment_forms_case_generation_uidx;
-- Replacement lineage columns intentionally remain as retained history metadata.