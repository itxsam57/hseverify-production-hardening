CREATE TABLE IF NOT EXISTS privacy_requests (
  request_id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access','correction','deletion','export')),
  status TEXT NOT NULL CHECK (status IN ('OPEN','PROCESSING','COMPLETED','REJECTED')) DEFAULT 'OPEN',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS privacy_requests_worker_idx ON privacy_requests(worker_id, created_at DESC);

CREATE TABLE IF NOT EXISTS accessibility_accommodations (
  accommodation_id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  accommodation_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','DECLINED')) DEFAULT 'REQUESTED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS retention_jobs (
  job_id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  retention_before TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETED')) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
