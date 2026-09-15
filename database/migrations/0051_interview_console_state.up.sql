CREATE TABLE IF NOT EXISTS interview_console_drafts (
  tenant_id TEXT NOT NULL,
  interview_session_id TEXT NOT NULL,
  interview_request_id TEXT NOT NULL,
  notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendation TEXT,
  submitted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, interview_session_id)
);

CREATE INDEX IF NOT EXISTS interview_console_drafts_request_idx
  ON interview_console_drafts (tenant_id, interview_request_id);
