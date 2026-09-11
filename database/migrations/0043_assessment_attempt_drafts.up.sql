-- M2.08 Answer Persistence and Interruption Recovery (narrow scope).
-- Mutable current-answer draft state remains separate from immutable M2.07 committed answers.
-- This migration intentionally does not change assessment_attempts lifecycle status vocabulary.

CREATE TABLE IF NOT EXISTS assessment_attempt_drafts (
  attempt_id TEXT PRIMARY KEY
    REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  form_id TEXT NOT NULL,
  form_item_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0 AND position <= 500),
  question_id TEXT NOT NULL
    REFERENCES assessment_questions(question_id) ON DELETE RESTRICT,
  question_version_id TEXT NOT NULL
    REFERENCES assessment_question_versions(question_version_id) ON DELETE RESTRICT,
  question_type TEXT NOT NULL CHECK (
    question_type IN (
      'MULTIPLE_CHOICE',
      'TRUE_FALSE',
      'SHORT_TEXT',
      'LONG_TEXT',
      'INTEGER',
      'DECIMAL'
    )
  ),
  text_value TEXT NULL,
  boolean_value BOOLEAN NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  latest_mutation_key TEXT NOT NULL CHECK (
    char_length(latest_mutation_key) BETWEEN 16 AND 160
    AND latest_mutation_key = btrim(latest_mutation_key)
  ),
  latest_mutation_digest TEXT NOT NULL CHECK (
    char_length(latest_mutation_digest) = 64
    AND latest_mutation_digest ~ '^[a-f0-9]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT assessment_attempt_drafts_attempt_form_fk
    FOREIGN KEY (attempt_id, form_id)
    REFERENCES assessment_attempts (attempt_id, form_id)
    ON DELETE RESTRICT,
  CONSTRAINT assessment_attempt_drafts_form_item_fk
    FOREIGN KEY (form_id, form_item_id)
    REFERENCES generated_assessment_form_items (form_id, form_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT assessment_attempt_drafts_item_lineage_fk
    FOREIGN KEY (form_id, form_item_id, position, question_id, question_version_id)
    REFERENCES generated_assessment_form_items (
      form_id, form_item_id, position, question_id, question_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT assessment_attempt_drafts_question_type_fk
    FOREIGN KEY (question_id, question_version_id, question_type)
    REFERENCES assessment_question_versions (question_id, question_version_id, question_type)
    ON DELETE RESTRICT,
  CHECK (
    (
      question_type = 'MULTIPLE_CHOICE'
      AND boolean_value IS NULL
    ) OR (
      question_type = 'TRUE_FALSE'
      AND text_value IS NULL
    ) OR (
      question_type IN ('SHORT_TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL')
      AND text_value IS NOT NULL
      AND boolean_value IS NULL
    )
  ),
  CHECK (
    question_type <> 'SHORT_TEXT'
    OR char_length(text_value) <= 2000
  ),
  CHECK (
    question_type <> 'LONG_TEXT'
    OR char_length(text_value) <= 20000
  ),
  CHECK (
    question_type NOT IN ('INTEGER', 'DECIMAL')
    OR char_length(text_value) <= 128
  )
);