CREATE TABLE IF NOT EXISTS interview_console_drafts (
  tenant_id text NOT NULL,
  interview_session_id text NOT NULL,
  interview_request_id text NOT NULL,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation text,
  submitted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, interview_session_id)
);

CREATE INDEX IF NOT EXISTS interview_console_drafts_request_idx
  ON interview_console_drafts (tenant_id, interview_request_id);
