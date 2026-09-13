-- M2.10 Written scoring and Review Engine foundation.
-- Stores rubric-based written scoring decisions and reviewer calibration without exposing answers.
CREATE TABLE IF NOT EXISTS written_score_reviews (
  review_id TEXT PRIMARY KEY CHECK (review_id ~ '^written_score_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^tenant_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL CHECK (case_id ~ '^assurance_case_[A-Za-z0-9_-]{24}$'),
  attempt_id TEXT NOT NULL CHECK (char_length(attempt_id) BETWEEN 8 AND 180),
  reviewer_account_id TEXT NOT NULL CHECK (char_length(reviewer_account_id) BETWEEN 8 AND 160),
  rubric_version TEXT NOT NULL CHECK (char_length(rubric_version) BETWEEN 1 AND 180),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  decision TEXT NOT NULL CHECK (decision IN ('PASS','FAIL','CHANGES_REQUESTED')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 4000),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL','SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS written_score_reviews_case_idx ON written_score_reviews(case_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS written_score_reviews_attempt_final_idx ON written_score_reviews(attempt_id) WHERE status='FINAL';

CREATE TABLE IF NOT EXISTS scoring_calibration_events (
  calibration_id TEXT PRIMARY KEY CHECK (calibration_id ~ '^score_calibration_[A-Za-z0-9_-]{24}$'),
  review_id TEXT NOT NULL,
  reviewer_account_id TEXT NOT NULL CHECK (char_length(reviewer_account_id) BETWEEN 8 AND 160),
  calibration_note TEXT NOT NULL CHECK (char_length(calibration_note) BETWEEN 5 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scoring_conflict_declarations (
  conflict_id TEXT PRIMARY KEY CHECK (conflict_id ~ '^score_conflict_[A-Za-z0-9_-]{24}$'),
  review_id TEXT NOT NULL,
  reviewer_account_id TEXT NOT NULL CHECK (char_length(reviewer_account_id) BETWEEN 8 AND 160),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS written_score_rubric_marks (
  mark_id TEXT PRIMARY KEY CHECK (mark_id ~ '^rubric_mark_[A-Za-z0-9_-]{24}$'),
  review_id TEXT NOT NULL,
  reviewer_account_id TEXT NOT NULL CHECK (char_length(reviewer_account_id) BETWEEN 8 AND 160),
  criterion TEXT NOT NULL CHECK (char_length(criterion) BETWEEN 2 AND 180),
  mark INTEGER NOT NULL CHECK (mark >= 0 AND mark <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS written_score_rubric_marks_review_idx ON written_score_rubric_marks(review_id);
