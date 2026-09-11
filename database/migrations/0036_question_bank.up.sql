-- M2.04 Question Bank. Stable questions point to immutable versions.

CREATE TABLE IF NOT EXISTS assessment_questions (
  question_id TEXT PRIMARY KEY CHECK (question_id ~ '^assessment_question_[A-Za-z0-9_-]{24}$'),
  question_reference TEXT NOT NULL UNIQUE CHECK (char_length(question_reference) BETWEEN 2 AND 120),
  question_status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK (question_status IN ('ACTIVE','INACTIVE')),
  current_version_id TEXT NULL CHECK (current_version_id IS NULL OR current_version_id ~ '^question_version_[A-Za-z0-9_-]{24}$'),
  current_content_fingerprint TEXT NULL CHECK (current_content_fingerprint IS NULL OR current_content_fingerprint ~ '^[a-f0-9]{64}$'),
  created_by_account_id TEXT NOT NULL CHECK (char_length(created_by_account_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (question_status='INACTIVE' OR (current_version_id IS NOT NULL AND current_content_fingerprint IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_questions_active_content_uq ON assessment_questions(current_content_fingerprint) WHERE question_status='ACTIVE';
CREATE INDEX IF NOT EXISTS assessment_questions_status_idx ON assessment_questions(question_status,updated_at DESC,question_id);

CREATE TABLE IF NOT EXISTS assessment_question_versions (
  question_version_id TEXT PRIMARY KEY CHECK (question_version_id ~ '^question_version_[A-Za-z0-9_-]{24}$'),
  question_id TEXT NOT NULL CHECK (question_id ~ '^assessment_question_[A-Za-z0-9_-]{24}$'),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  question_type TEXT NOT NULL CHECK (question_type IN ('MULTIPLE_CHOICE','TRUE_FALSE','SHORT_TEXT','LONG_TEXT','INTEGER','DECIMAL')),
  prompt TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 10 AND 5000),
  options_json JSONB NULL,
  answer_key_json JSONB NULL,
  rubric_json JSONB NULL,
  framework_id TEXT NOT NULL CHECK (framework_id ~ '^framework_[A-Za-z0-9_-]{24}$'),
  domain_reference TEXT NOT NULL CHECK (char_length(domain_reference) BETWEEN 2 AND 160),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('EASY','MEDIUM','HARD')),
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags_json)='array'),
  content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  created_by_account_id TEXT NOT NULL CHECK (char_length(created_by_account_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(question_id,version_no),
  CHECK (
    (question_type='MULTIPLE_CHOICE' AND jsonb_typeof(options_json)='array' AND answer_key_json IS NOT NULL AND rubric_json IS NULL)
    OR (question_type='TRUE_FALSE' AND options_json IS NULL AND jsonb_typeof(answer_key_json)='boolean' AND rubric_json IS NULL)
    OR (question_type IN ('INTEGER','DECIMAL') AND options_json IS NULL AND jsonb_typeof(answer_key_json)='number' AND rubric_json IS NULL)
    OR (question_type IN ('SHORT_TEXT','LONG_TEXT') AND options_json IS NULL AND answer_key_json IS NULL AND jsonb_typeof(rubric_json)='object')
  )
);
CREATE INDEX IF NOT EXISTS assessment_question_versions_question_idx ON assessment_question_versions(question_id,version_no DESC);
CREATE INDEX IF NOT EXISTS assessment_question_versions_selector_idx ON assessment_question_versions(framework_id,domain_reference,difficulty,question_type);

CREATE OR REPLACE FUNCTION hse_question_version_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Question version history is append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS assessment_question_versions_append_only ON assessment_question_versions;
CREATE TRIGGER assessment_question_versions_append_only BEFORE UPDATE OR DELETE ON assessment_question_versions FOR EACH ROW EXECUTE FUNCTION hse_question_version_append_only();
