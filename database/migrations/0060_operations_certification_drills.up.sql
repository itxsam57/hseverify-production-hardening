CREATE TABLE IF NOT EXISTS operations_certification_drills (
  drill_id TEXT PRIMARY KEY,
  drill_name TEXT NOT NULL CHECK (drill_name IN ('concurrency','tenant_isolation','restore','incident')),
  status TEXT NOT NULL CHECK (status IN ('passed','failed')),
  evidence TEXT NOT NULL CHECK (char_length(trim(evidence)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS operations_certification_drills_created_idx
  ON operations_certification_drills(created_at DESC);
