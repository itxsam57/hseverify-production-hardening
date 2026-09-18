ALTER TABLE interview_console_drafts
  ADD COLUMN IF NOT EXISTS scorecard jsonb NOT NULL DEFAULT '{"technicalKnowledge":null,"safetyAwareness":null,"comments":null}'::jsonb;
