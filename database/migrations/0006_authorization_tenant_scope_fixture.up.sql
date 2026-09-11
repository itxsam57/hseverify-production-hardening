ALTER TABLE auth_tenant_memberships
  ADD CONSTRAINT auth_tenant_membership_tenant_identity
  UNIQUE (membership_id, tenant_id);

CREATE TABLE authorization_tenant_scope_fixtures (
  fixture_id TEXT NOT NULL CHECK (
    fixture_id ~ '^tenantfixture_[A-Za-z0-9_-]{24}$'
  ),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  record_key TEXT NOT NULL CHECK (
    char_length(record_key) BETWEEN 3 AND 64 AND
    record_key ~ '^[a-z0-9][a-z0-9_-]*[a-z0-9]$'
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(payload) = 'object'
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by_membership_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, fixture_id),
  CONSTRAINT authorization_tenant_scope_fixture_key_unique
    UNIQUE (tenant_id, record_key),
  CONSTRAINT authorization_tenant_scope_fixture_membership_fk
    FOREIGN KEY (created_by_membership_id, tenant_id)
    REFERENCES auth_tenant_memberships (membership_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX authorization_tenant_scope_fixture_updated_idx
  ON authorization_tenant_scope_fixtures (tenant_id, updated_at DESC, fixture_id);

COMMENT ON TABLE authorization_tenant_scope_fixtures IS
  'Temporary neutral authorization-enforcement fixture for M1.04 tenant-scoped repository and command contracts; not a business-domain table.';
