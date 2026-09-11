-- M2.08 narrow-scope rollback.
-- Remove only mutable draft state; preserve M2.07 attempts, committed answers, forms, and history.

DROP TABLE IF EXISTS assessment_attempt_drafts;