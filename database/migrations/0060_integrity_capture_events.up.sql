CREATE TABLE IF NOT EXISTS integrity_capture_events (
  event_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  classification TEXT NOT NULL,
  state TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS integrity_capture_events_attempt_idx
  ON integrity_capture_events (attempt_id, occurred_at);
