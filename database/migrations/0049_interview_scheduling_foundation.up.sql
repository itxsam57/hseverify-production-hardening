CREATE TABLE IF NOT EXISTS interview_requests (
  interview_request_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  worker_account_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('REQUESTED','ASSIGNED','WAITING_ROOM','COMPLETED','CANCELLED')),
  requested_at timestamptz NOT NULL,
  scheduled_at timestamptz NULL,
  assessor_account_id text NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  reminder_at timestamptz NULL,
  reschedule_reason text NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS interview_requests_tenant_id_lookup
  ON interview_requests(tenant_id, interview_request_id);

CREATE INDEX IF NOT EXISTS interview_requests_case_lookup ON interview_requests(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS interview_requests_assessor_lookup ON interview_requests(tenant_id, assessor_account_id);

CREATE TABLE IF NOT EXISTS interview_console_drafts (
  tenant_id text NOT NULL,
  interview_session_id text NOT NULL,
  interview_request_id text NOT NULL,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation text NULL,
  submitted boolean NOT NULL DEFAULT FALSE,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, interview_session_id),
  FOREIGN KEY (tenant_id, interview_request_id) REFERENCES interview_requests(tenant_id, interview_request_id)
);

CREATE INDEX IF NOT EXISTS interview_console_request_lookup ON interview_console_drafts(tenant_id, interview_request_id);
