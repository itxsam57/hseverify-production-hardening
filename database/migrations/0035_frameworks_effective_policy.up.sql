-- M2.03 Frameworks and Effective Policy.
-- Global policy/version rows and tenant overrides are history-bearing. Cases pin immutable effective snapshots.

CREATE TABLE IF NOT EXISTS assurance_frameworks (
  framework_id TEXT PRIMARY KEY CHECK (framework_id ~ '^framework_[A-Za-z0-9_-]{24}$'),
  framework_reference TEXT NOT NULL UNIQUE CHECK (char_length(framework_reference) BETWEEN 2 AND 120),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  framework_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (framework_status IN ('ACTIVE','INACTIVE')),
  created_by_account_id TEXT NOT NULL CHECK (char_length(created_by_account_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assurance_policy_packs (
  policy_id TEXT PRIMARY KEY CHECK (policy_id ~ '^policy_[A-Za-z0-9_-]{24}$'),
  framework_id TEXT NOT NULL CHECK (framework_id ~ '^framework_[A-Za-z0-9_-]{24}$'),
  policy_reference TEXT NOT NULL UNIQUE CHECK (char_length(policy_reference) BETWEEN 2 AND 120),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  policy_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (policy_status IN ('ACTIVE','INACTIVE')),
  created_by_account_id TEXT NOT NULL CHECK (char_length(created_by_account_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(framework_id,policy_reference)
);
CREATE INDEX IF NOT EXISTS assurance_policy_packs_framework_idx ON assurance_policy_packs(framework_id,policy_status,policy_reference);

CREATE TABLE IF NOT EXISTS assurance_policy_versions (
  policy_version_id TEXT PRIMARY KEY CHECK (policy_version_id ~ '^policy_version_[A-Za-z0-9_-]{24}$'),
  policy_id TEXT NOT NULL CHECK (policy_id ~ '^policy_[A-Za-z0-9_-]{24}$'),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  version_status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (version_status IN ('PUBLISHED','RETIRED')),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,
  policy_values JSONB NOT NULL CHECK (jsonb_typeof(policy_values)='object'),
  override_allowed_fields JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(override_allowed_fields)='array'),
  override_directions JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(override_directions)='object'),
  created_by_account_id TEXT NOT NULL CHECK (char_length(created_by_account_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE(policy_id,version_no)
);
CREATE INDEX IF NOT EXISTS assurance_policy_versions_effective_idx ON assurance_policy_versions(policy_id,version_status,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS tenant_policy_overrides (
  override_id TEXT PRIMARY KEY CHECK (override_id ~ '^policy_override_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^tenant_[A-Za-z0-9_-]{24}$'),
  policy_id TEXT NOT NULL CHECK (policy_id ~ '^policy_[A-Za-z0-9_-]{24}$'),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  override_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (override_status IN ('ACTIVE','INACTIVE')),
  override_values JSONB NOT NULL CHECK (jsonb_typeof(override_values)='object'),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,
  created_by_membership_id TEXT NOT NULL CHECK (char_length(created_by_membership_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE(tenant_id,policy_id,version_no)
);
CREATE INDEX IF NOT EXISTS tenant_policy_overrides_effective_idx ON tenant_policy_overrides(tenant_id,policy_id,override_status,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS assurance_case_policy_snapshots (
  snapshot_id TEXT PRIMARY KEY CHECK (snapshot_id ~ '^policy_snapshot_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL UNIQUE CHECK (case_id ~ '^assurance_case_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^tenant_[A-Za-z0-9_-]{24}$'),
  framework_id TEXT NOT NULL CHECK (framework_id ~ '^framework_[A-Za-z0-9_-]{24}$'),
  policy_id TEXT NOT NULL CHECK (policy_id ~ '^policy_[A-Za-z0-9_-]{24}$'),
  global_policy_version_id TEXT NOT NULL CHECK (global_policy_version_id ~ '^policy_version_[A-Za-z0-9_-]{24}$'),
  tenant_override_id TEXT NULL CHECK (tenant_override_id IS NULL OR tenant_override_id ~ '^policy_override_[A-Za-z0-9_-]{24}$'),
  policy_source TEXT NOT NULL CHECK (policy_source IN ('GLOBAL','GLOBAL_PLUS_TENANT_OVERRIDE')),
  effective_value_json JSONB NOT NULL CHECK (jsonb_typeof(effective_value_json)='object'),
  reference_time TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_account_id TEXT NULL CHECK (created_by_account_id IS NULL OR char_length(created_by_account_id) BETWEEN 8 AND 160)
);
CREATE INDEX IF NOT EXISTS assurance_case_policy_snapshots_tenant_idx ON assurance_case_policy_snapshots(tenant_id,policy_id,resolved_at DESC);

CREATE OR REPLACE FUNCTION hse_effective_policy_history_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Effective policy version/override/snapshot history is append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS assurance_policy_versions_append_only ON assurance_policy_versions;
CREATE TRIGGER assurance_policy_versions_append_only BEFORE UPDATE OR DELETE ON assurance_policy_versions FOR EACH ROW EXECUTE FUNCTION hse_effective_policy_history_append_only();
DROP TRIGGER IF EXISTS tenant_policy_overrides_append_only ON tenant_policy_overrides;
CREATE TRIGGER tenant_policy_overrides_append_only BEFORE UPDATE OR DELETE ON tenant_policy_overrides FOR EACH ROW EXECUTE FUNCTION hse_effective_policy_history_append_only();
DROP TRIGGER IF EXISTS assurance_case_policy_snapshots_append_only ON assurance_case_policy_snapshots;
CREATE TRIGGER assurance_case_policy_snapshots_append_only BEFORE UPDATE OR DELETE ON assurance_case_policy_snapshots FOR EACH ROW EXECUTE FUNCTION hse_effective_policy_history_append_only();
