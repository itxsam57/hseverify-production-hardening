CREATE TABLE IF NOT EXISTS hse_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  release_sha TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_profiles (
  worker_sub TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  version INTEGER NOT NULL CHECK (version >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'submitted')),
  profile_document JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS worker_profiles_status_idx
  ON worker_profiles (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS deployment_releases (
  release_sha TEXT PRIMARY KEY,
  application_environment TEXT NOT NULL CHECK (
    application_environment IN ('development', 'test', 'preview', 'production')
  ),
  package_lock_sha256 TEXT NOT NULL,
  migration_set_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
