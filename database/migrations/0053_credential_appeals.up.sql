CREATE TABLE IF NOT EXISTS credential_appeals (
  appeal_id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS credential_appeals_worker_lookup
  ON credential_appeals(worker_id);

CREATE INDEX IF NOT EXISTS credential_appeals_credential_lookup
  ON credential_appeals(credential_id);

CREATE TABLE IF NOT EXISTS credential_appeal_events (
  appeal_id TEXT NOT NULL REFERENCES credential_appeals(appeal_id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (appeal_id, version)
);
