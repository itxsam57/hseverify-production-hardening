CREATE TABLE IF NOT EXISTS interview_media_signals (
  signal_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  interview_request_id text NOT NULL,
  actor_account_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('worker','assessor')),
  signal_kind text NOT NULL CHECK (signal_kind IN ('offer','answer','ice','leave')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, interview_request_id)
    REFERENCES interview_requests(tenant_id, interview_request_id)
);

CREATE INDEX IF NOT EXISTS interview_media_signals_request_created_idx
  ON interview_media_signals (tenant_id, interview_request_id, created_at, signal_id);
