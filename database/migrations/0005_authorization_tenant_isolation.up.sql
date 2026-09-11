CREATE TABLE IF NOT EXISTS platform_tenants (
  tenant_id TEXT PRIMARY KEY CHECK (
    tenant_id ~ '^tenant_[A-Za-z0-9_-]{24}$'
  ),
  tenant_type TEXT NOT NULL CHECK (tenant_type IN ('company')),
  display_name TEXT NOT NULL CHECK (
    char_length(trim(display_name)) BETWEEN 2 AND 200
  ),
  tenant_status TEXT NOT NULL CHECK (
    tenant_status IN ('pending', 'active', 'suspended', 'archived')
  ),
  created_by_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMPTZ NULL,
  suspended_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT platform_tenants_state_check CHECK (
    (
      tenant_status = 'pending' AND
      activated_at IS NULL AND suspended_at IS NULL AND archived_at IS NULL
    ) OR (
      tenant_status = 'active' AND
      activated_at IS NOT NULL AND suspended_at IS NULL AND archived_at IS NULL
    ) OR (
      tenant_status = 'suspended' AND
      activated_at IS NOT NULL AND suspended_at IS NOT NULL AND archived_at IS NULL
    ) OR (
      tenant_status = 'archived' AND
      archived_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS platform_tenants_status_idx
  ON platform_tenants (tenant_type, tenant_status, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_tenant_role_permission_ceiling (
  membership_role TEXT NOT NULL CHECK (
    membership_role IN ('owner', 'admin', 'manager', 'viewer')
  ),
  permission_key TEXT NOT NULL CHECK (
    permission_key IN (
      'company.tenant.read',
      'company.settings.manage',
      'company.members.read',
      'company.members.manage',
      'company.members.grant_owner',
      'company.workforce.read',
      'company.workforce.manage',
      'company.orders.read',
      'company.orders.manage',
      'company.billing.read',
      'company.billing.manage',
      'company.reports.read',
      'company.reports.export',
      'company.audit.read'
    )
    AND permission_key NOT LIKE '%*%'
  ),
  PRIMARY KEY (membership_role, permission_key)
);

INSERT INTO auth_tenant_role_permission_ceiling (membership_role, permission_key)
VALUES
  ('viewer', 'company.tenant.read'),
  ('viewer', 'company.workforce.read'),
  ('viewer', 'company.orders.read'),
  ('viewer', 'company.reports.read'),
  ('manager', 'company.tenant.read'),
  ('manager', 'company.workforce.read'),
  ('manager', 'company.workforce.manage'),
  ('manager', 'company.orders.read'),
  ('manager', 'company.orders.manage'),
  ('manager', 'company.reports.read'),
  ('manager', 'company.reports.export'),
  ('admin', 'company.tenant.read'),
  ('admin', 'company.settings.manage'),
  ('admin', 'company.members.read'),
  ('admin', 'company.members.manage'),
  ('admin', 'company.workforce.read'),
  ('admin', 'company.workforce.manage'),
  ('admin', 'company.orders.read'),
  ('admin', 'company.orders.manage'),
  ('admin', 'company.billing.read'),
  ('admin', 'company.billing.manage'),
  ('admin', 'company.reports.read'),
  ('admin', 'company.reports.export'),
  ('admin', 'company.audit.read'),
  ('owner', 'company.tenant.read'),
  ('owner', 'company.settings.manage'),
  ('owner', 'company.members.read'),
  ('owner', 'company.members.manage'),
  ('owner', 'company.members.grant_owner'),
  ('owner', 'company.workforce.read'),
  ('owner', 'company.workforce.manage'),
  ('owner', 'company.orders.read'),
  ('owner', 'company.orders.manage'),
  ('owner', 'company.billing.read'),
  ('owner', 'company.billing.manage'),
  ('owner', 'company.reports.read'),
  ('owner', 'company.reports.export'),
  ('owner', 'company.audit.read')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS auth_tenant_memberships (
  membership_id TEXT PRIMARY KEY CHECK (
    membership_id ~ '^membership_[A-Za-z0-9_-]{24}$'
  ),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  portal_role TEXT NOT NULL DEFAULT 'company' CHECK (portal_role = 'company'),
  membership_role TEXT NOT NULL CHECK (
    membership_role IN ('owner', 'admin', 'manager', 'viewer')
  ),
  membership_status TEXT NOT NULL CHECK (
    membership_status IN ('invited', 'active', 'suspended', 'revoked')
  ),
  created_by_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMPTZ NULL,
  suspended_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT auth_tenant_membership_role_identity
    UNIQUE (membership_id, membership_role),
  CONSTRAINT auth_tenant_membership_company_role_fk
    FOREIGN KEY (account_id, portal_role)
    REFERENCES auth_account_roles (account_id, role)
    ON DELETE CASCADE,
  CONSTRAINT auth_tenant_membership_state_check CHECK (
    (
      membership_status = 'invited' AND
      activated_at IS NULL AND suspended_at IS NULL AND revoked_at IS NULL
    ) OR (
      membership_status = 'active' AND
      activated_at IS NOT NULL AND suspended_at IS NULL AND revoked_at IS NULL
    ) OR (
      membership_status = 'suspended' AND
      activated_at IS NOT NULL AND suspended_at IS NOT NULL AND revoked_at IS NULL
    ) OR (
      membership_status = 'revoked' AND
      revoked_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_current_tenant_membership_idx
  ON auth_tenant_memberships (tenant_id, account_id)
  WHERE membership_status IN ('invited', 'active', 'suspended');

CREATE UNIQUE INDEX IF NOT EXISTS auth_current_company_membership_account_idx
  ON auth_tenant_memberships (account_id)
  WHERE membership_status IN ('invited', 'active', 'suspended');

CREATE INDEX IF NOT EXISTS auth_tenant_membership_account_idx
  ON auth_tenant_memberships (account_id, membership_status, tenant_id);

CREATE INDEX IF NOT EXISTS auth_tenant_membership_tenant_idx
  ON auth_tenant_memberships (tenant_id, membership_status, membership_role);

CREATE TABLE IF NOT EXISTS auth_tenant_permission_overrides (
  membership_id TEXT NOT NULL,
  membership_role TEXT NOT NULL CHECK (
    membership_role IN ('owner', 'admin', 'manager', 'viewer')
  ),
  permission_key TEXT NOT NULL CHECK (
    permission_key IN (
      'company.tenant.read',
      'company.settings.manage',
      'company.members.read',
      'company.members.manage',
      'company.members.grant_owner',
      'company.workforce.read',
      'company.workforce.manage',
      'company.orders.read',
      'company.orders.manage',
      'company.billing.read',
      'company.billing.manage',
      'company.reports.read',
      'company.reports.export',
      'company.audit.read'
    )
    AND permission_key NOT LIKE '%*%'
  ),
  effect TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  created_by_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (membership_id, permission_key),
  CONSTRAINT auth_tenant_permission_membership_role_fk
    FOREIGN KEY (membership_id, membership_role)
    REFERENCES auth_tenant_memberships (membership_id, membership_role)
    ON DELETE CASCADE,
  CONSTRAINT auth_tenant_permission_role_ceiling_fk
    FOREIGN KEY (membership_role, permission_key)
    REFERENCES auth_tenant_role_permission_ceiling (membership_role, permission_key)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS auth_tenant_permission_override_actor_idx
  ON auth_tenant_permission_overrides (created_by_account_id, created_at DESC);
