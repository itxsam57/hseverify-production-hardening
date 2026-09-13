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

CREATE INDEX IF NOT EXISTS interview_requests_case_lookup ON interview_requests(tenant_id, case_id);
