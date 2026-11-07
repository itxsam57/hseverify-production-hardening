-- Reviewer reasons remain private unless the reviewer explicitly opts in.
ALTER TABLE evidence_review_decisions
  ADD COLUMN assessor_visible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE written_score_reviews
  ADD COLUMN assessor_visible BOOLEAN NOT NULL DEFAULT FALSE;
