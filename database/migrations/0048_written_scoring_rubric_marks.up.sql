-- M2.10 rubric-level scoring evidence.
CREATE TABLE IF NOT EXISTS written_score_rubric_marks (
  mark_id TEXT PRIMARY KEY CHECK (mark_id ~ '^rubric_mark_[A-Za-z0-9_-]{24}$'),
  review_id TEXT NOT NULL,
  reviewer_account_id TEXT NOT NULL CHECK (char_length(reviewer_account_id) BETWEEN 8 AND 160),
  criterion TEXT NOT NULL CHECK (char_length(criterion) BETWEEN 2 AND 180),
  mark INTEGER NOT NULL CHECK (mark >= 0 AND mark <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS written_score_rubric_marks_review_idx ON written_score_rubric_marks(review_id, created_at);
