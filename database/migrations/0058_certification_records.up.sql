CREATE TABLE IF NOT EXISTS certification_records (
  certification_id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  qualification TEXT NOT NULL,
  status TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certification_record_events (
  event_id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
