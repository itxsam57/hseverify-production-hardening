CREATE TABLE IF NOT EXISTS company_sites (
  site_id TEXT PRIMARY KEY CHECK (site_id ~ '^site_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 160),
  formatted_address TEXT NOT NULL CHECK (char_length(trim(formatted_address)) BETWEEN 2 AND 500),
  phone TEXT NOT NULL CHECK (char_length(trim(phone)) BETWEEN 3 AND 32),
  website TEXT NOT NULL CHECK (char_length(trim(website)) BETWEEN 5 AND 240),
  email_normalized TEXT NOT NULL CHECK (char_length(trim(email_normalized)) BETWEEN 3 AND 320),
  registration_number TEXT NULL CHECK (
    registration_number IS NULL OR char_length(trim(registration_number)) BETWEEN 1 AND 120
  ),
  site_status TEXT NOT NULL DEFAULT 'active' CHECK (site_status IN ('active', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by_membership_id TEXT NOT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT company_sites_state_check CHECK (
    (site_status = 'active' AND archived_at IS NULL) OR
    (site_status = 'archived' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT company_sites_tenant_site_unique UNIQUE (tenant_id, site_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_sites_active_name_idx
  ON company_sites (tenant_id, lower(trim(name)))
  WHERE site_status = 'active';
CREATE INDEX IF NOT EXISTS company_sites_tenant_status_idx
  ON company_sites (tenant_id, site_status, name);

CREATE TABLE IF NOT EXISTS company_departments (
  department_id TEXT PRIMARY KEY CHECK (department_id ~ '^department_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 160),
  formatted_address TEXT NOT NULL CHECK (char_length(trim(formatted_address)) BETWEEN 2 AND 500),
  phone TEXT NOT NULL CHECK (char_length(trim(phone)) BETWEEN 3 AND 32),
  website TEXT NOT NULL CHECK (char_length(trim(website)) BETWEEN 5 AND 240),
  email_normalized TEXT NOT NULL CHECK (char_length(trim(email_normalized)) BETWEEN 3 AND 320),
  registration_number TEXT NULL CHECK (
    registration_number IS NULL OR char_length(trim(registration_number)) BETWEEN 1 AND 120
  ),
  department_status TEXT NOT NULL DEFAULT 'active' CHECK (department_status IN ('active', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by_membership_id TEXT NOT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT company_departments_state_check CHECK (
    (department_status = 'active' AND archived_at IS NULL) OR
    (department_status = 'archived' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT company_departments_tenant_department_unique UNIQUE (tenant_id, department_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_departments_active_name_idx
  ON company_departments (tenant_id, lower(trim(name)))
  WHERE department_status = 'active';
CREATE INDEX IF NOT EXISTS company_departments_tenant_status_idx
  ON company_departments (tenant_id, department_status, name);

CREATE TABLE IF NOT EXISTS company_team_invitation_bindings (
  invitation_id TEXT PRIMARY KEY REFERENCES auth_staff_invitations(invitation_id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL UNIQUE CHECK (membership_id ~ '^membership_[A-Za-z0-9_-]{24}$'),
  initial_assignment_id TEXT NULL UNIQUE CHECK (
    initial_assignment_id IS NULL OR initial_assignment_id ~ '^teamassignment_[A-Za-z0-9_-]{24}$'
  ),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  invited_by_membership_id TEXT NOT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  membership_role TEXT NOT NULL CHECK (membership_role IN ('owner', 'admin', 'manager', 'viewer')),
  site_id TEXT NULL,
  department_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_team_invitation_scope_check CHECK (
    (initial_assignment_id IS NULL AND site_id IS NULL AND department_id IS NULL) OR
    (initial_assignment_id IS NOT NULL AND (site_id IS NOT NULL OR department_id IS NOT NULL))
  ),
  CONSTRAINT company_team_invitation_site_fk FOREIGN KEY (tenant_id, site_id)
    REFERENCES company_sites(tenant_id, site_id) ON DELETE RESTRICT,
  CONSTRAINT company_team_invitation_department_fk FOREIGN KEY (tenant_id, department_id)
    REFERENCES company_departments(tenant_id, department_id) ON DELETE RESTRICT,
  CONSTRAINT company_team_invitation_role_unique UNIQUE (invitation_id, membership_role)
);

CREATE INDEX IF NOT EXISTS company_team_invitation_tenant_idx
  ON company_team_invitation_bindings (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_team_invitation_permissions (
  invitation_id TEXT NOT NULL,
  membership_role TEXT NOT NULL CHECK (membership_role IN ('owner', 'admin', 'manager', 'viewer')),
  permission_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (invitation_id, permission_key),
  CONSTRAINT company_team_invitation_permission_binding_fk
    FOREIGN KEY (invitation_id, membership_role)
    REFERENCES company_team_invitation_bindings(invitation_id, membership_role)
    ON DELETE CASCADE,
  CONSTRAINT company_team_invitation_permission_ceiling_fk
    FOREIGN KEY (membership_role, permission_key)
    REFERENCES auth_tenant_role_permission_ceiling(membership_role, permission_key)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS company_team_unit_assignments (
  assignment_id TEXT PRIMARY KEY CHECK (assignment_id ~ '^teamassignment_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  site_id TEXT NULL,
  department_id TEXT NULL,
  assigned_by_membership_id TEXT NOT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMPTZ NULL,
  ended_reason TEXT NULL CHECK (ended_reason IS NULL OR char_length(trim(ended_reason)) BETWEEN 3 AND 240),
  CONSTRAINT company_team_assignment_unit_check CHECK (site_id IS NOT NULL OR department_id IS NOT NULL),
  CONSTRAINT company_team_assignment_end_check CHECK (
    (ended_at IS NULL AND ended_reason IS NULL) OR
    (ended_at IS NOT NULL AND ended_reason IS NOT NULL AND ended_at >= assigned_at)
  ),
  CONSTRAINT company_team_assignment_site_fk FOREIGN KEY (tenant_id, site_id)
    REFERENCES company_sites(tenant_id, site_id) ON DELETE RESTRICT,
  CONSTRAINT company_team_assignment_department_fk FOREIGN KEY (tenant_id, department_id)
    REFERENCES company_departments(tenant_id, department_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS company_team_active_assignment_idx
  ON company_team_unit_assignments (tenant_id, membership_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS company_team_assignment_history_idx
  ON company_team_unit_assignments (tenant_id, membership_id, assigned_at DESC);

CREATE OR REPLACE FUNCTION hse_validate_company_team_invitation_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invitation_record auth_staff_invitations%ROWTYPE;
  inviter_record auth_tenant_memberships%ROWTYPE;
BEGIN
  SELECT * INTO invitation_record
  FROM auth_staff_invitations
  WHERE invitation_id = NEW.invitation_id
  FOR UPDATE;

  IF NOT FOUND OR invitation_record.role <> 'company' OR invitation_record.invitation_status <> 'pending' THEN
    RAISE EXCEPTION 'Invalid Company team invitation binding';
  END IF;

  SELECT * INTO inviter_record
  FROM auth_tenant_memberships
  WHERE membership_id = NEW.invited_by_membership_id
  FOR UPDATE;

  IF NOT FOUND OR inviter_record.tenant_id <> NEW.tenant_id OR inviter_record.membership_status <> 'active'
     OR invitation_record.invited_by_account_id IS DISTINCT FROM inviter_record.account_id THEN
    RAISE EXCEPTION 'Invalid Company team inviter authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform_tenants t
    WHERE t.tenant_id = NEW.tenant_id AND t.tenant_status = 'active'
  ) OR NOT EXISTS (
    SELECT 1
    FROM auth_tenant_role_permission_ceiling c
    LEFT JOIN auth_tenant_permission_overrides o
      ON o.membership_id = inviter_record.membership_id
     AND o.membership_role = inviter_record.membership_role
     AND o.permission_key = c.permission_key
     AND o.effect = 'deny'
    WHERE c.membership_role = inviter_record.membership_role
      AND c.permission_key = 'company.members.manage'
      AND o.membership_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid Company team inviter authority';
  END IF;

  IF inviter_record.membership_role = 'admin' AND NEW.membership_role NOT IN ('manager', 'viewer') THEN
    RAISE EXCEPTION 'Company administrator cannot grant requested role';
  ELSIF inviter_record.membership_role <> 'owner' AND inviter_record.membership_role <> 'admin' THEN
    RAISE EXCEPTION 'Company team inviter cannot grant requested role';
  END IF;

  IF NEW.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_sites s
    WHERE s.tenant_id = NEW.tenant_id AND s.site_id = NEW.site_id AND s.site_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Archived or unavailable Company site cannot receive assignment';
  END IF;
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_departments d
    WHERE d.tenant_id = NEW.tenant_id AND d.department_id = NEW.department_id AND d.department_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Archived or unavailable Company department cannot receive assignment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_team_validate_invitation_binding ON company_team_invitation_bindings;
CREATE TRIGGER company_team_validate_invitation_binding
BEFORE INSERT OR UPDATE ON company_team_invitation_bindings
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_team_invitation_binding();

CREATE OR REPLACE FUNCTION hse_validate_company_team_invitation_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  binding_record company_team_invitation_bindings%ROWTYPE;
  inviter_record auth_tenant_memberships%ROWTYPE;
BEGIN
  SELECT * INTO binding_record
  FROM company_team_invitation_bindings
  WHERE invitation_id = NEW.invitation_id;
  IF NOT FOUND OR binding_record.membership_role <> NEW.membership_role THEN
    RAISE EXCEPTION 'Invalid Company team invitation permission';
  END IF;

  SELECT * INTO inviter_record
  FROM auth_tenant_memberships
  WHERE membership_id = binding_record.invited_by_membership_id;
  IF NOT FOUND OR inviter_record.membership_status <> 'active' THEN
    RAISE EXCEPTION 'Invalid Company team inviter permission';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth_tenant_role_permission_ceiling c
    LEFT JOIN auth_tenant_permission_overrides o
      ON o.membership_id = inviter_record.membership_id
     AND o.membership_role = inviter_record.membership_role
     AND o.permission_key = NEW.permission_key
     AND o.effect = 'deny'
    WHERE c.membership_role = inviter_record.membership_role
      AND c.permission_key = NEW.permission_key
      AND o.membership_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Company user cannot grant permission they do not possess';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_team_validate_invitation_permission ON company_team_invitation_permissions;
CREATE TRIGGER company_team_validate_invitation_permission
BEFORE INSERT OR UPDATE ON company_team_invitation_permissions
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_team_invitation_permission();

CREATE OR REPLACE FUNCTION hse_validate_company_team_unit_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth_tenant_memberships m
    JOIN platform_tenants t ON t.tenant_id = m.tenant_id
    WHERE m.membership_id = NEW.membership_id
      AND m.tenant_id = NEW.tenant_id
      AND m.portal_role = 'company'
      AND m.membership_status = 'active'
      AND t.tenant_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Inactive Company membership cannot receive unit assignment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth_tenant_memberships m
    WHERE m.membership_id = NEW.assigned_by_membership_id
      AND m.tenant_id = NEW.tenant_id
      AND m.membership_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Invalid Company assignment authority';
  END IF;
  IF NEW.ended_at IS NULL AND NEW.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_sites s
    WHERE s.tenant_id = NEW.tenant_id AND s.site_id = NEW.site_id AND s.site_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Archived Company site cannot receive active assignment';
  END IF;
  IF NEW.ended_at IS NULL AND NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_departments d
    WHERE d.tenant_id = NEW.tenant_id AND d.department_id = NEW.department_id AND d.department_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Archived Company department cannot receive active assignment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_team_validate_unit_assignment ON company_team_unit_assignments;
CREATE TRIGGER company_team_validate_unit_assignment
BEFORE INSERT OR UPDATE ON company_team_unit_assignments
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_team_unit_assignment();

CREATE OR REPLACE FUNCTION hse_archive_company_unit_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'company_sites' AND OLD.site_status = 'active' AND NEW.site_status = 'archived' THEN
    UPDATE company_team_unit_assignments
    SET ended_at = COALESCE(ended_at, NEW.archived_at),
        ended_reason = COALESCE(ended_reason, 'Site archived')
    WHERE tenant_id = NEW.tenant_id AND site_id = NEW.site_id AND ended_at IS NULL;
  ELSIF TG_TABLE_NAME = 'company_departments' AND OLD.department_status = 'active' AND NEW.department_status = 'archived' THEN
    UPDATE company_team_unit_assignments
    SET ended_at = COALESCE(ended_at, NEW.archived_at),
        ended_reason = COALESCE(ended_reason, 'Department archived')
    WHERE tenant_id = NEW.tenant_id AND department_id = NEW.department_id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_sites_archive_assignments ON company_sites;
CREATE TRIGGER company_sites_archive_assignments
AFTER UPDATE OF site_status ON company_sites
FOR EACH ROW EXECUTE FUNCTION hse_archive_company_unit_assignments();
DROP TRIGGER IF EXISTS company_departments_archive_assignments ON company_departments;
CREATE TRIGGER company_departments_archive_assignments
AFTER UPDATE OF department_status ON company_departments
FOR EACH ROW EXECUTE FUNCTION hse_archive_company_unit_assignments();

CREATE OR REPLACE FUNCTION hse_activate_company_team_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  binding_record company_team_invitation_bindings%ROWTYPE;
  inviter_account_id TEXT;
BEGIN
  IF OLD.invitation_status = NEW.invitation_status OR NEW.invitation_status <> 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO binding_record
  FROM company_team_invitation_bindings
  WHERE invitation_id = NEW.invitation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.role <> 'company' OR NEW.accepted_by_account_id IS NULL OR NEW.accepted_at IS NULL THEN
    RAISE EXCEPTION 'Company team invitation acceptance is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth_accounts a
    JOIN auth_account_roles r ON r.account_id = a.account_id AND r.role = 'company'
    JOIN auth_mfa_factors f ON f.account_id = a.account_id AND f.factor_type = 'totp' AND f.factor_status = 'active'
    WHERE a.account_id = NEW.accepted_by_account_id
      AND a.account_status = 'active'
      AND a.email_normalized = NEW.email_normalized
  ) THEN
    RAISE EXCEPTION 'Company team membership requires active Company account and MFA';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform_tenants t
    WHERE t.tenant_id = binding_record.tenant_id AND t.tenant_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company team membership requires active tenant';
  END IF;

  SELECT account_id INTO inviter_account_id
  FROM auth_tenant_memberships
  WHERE membership_id = binding_record.invited_by_membership_id
    AND tenant_id = binding_record.tenant_id
    AND membership_status = 'active';
  IF inviter_account_id IS NULL THEN
    RAISE EXCEPTION 'Company team inviter is no longer active';
  END IF;

  INSERT INTO auth_tenant_memberships (
    membership_id, tenant_id, account_id, portal_role, membership_role,
    membership_status, created_by_account_id, created_at, updated_at, activated_at
  ) VALUES (
    binding_record.membership_id, binding_record.tenant_id, NEW.accepted_by_account_id,
    'company', binding_record.membership_role, 'active', inviter_account_id,
    NEW.accepted_at, NEW.accepted_at, NEW.accepted_at
  );

  INSERT INTO auth_tenant_permission_overrides (
    membership_id, membership_role, permission_key, effect,
    created_by_account_id, reason, created_at
  )
  SELECT binding_record.membership_id, binding_record.membership_role,
         c.permission_key, 'deny', inviter_account_id,
         'Not selected in Company staff invitation', NEW.accepted_at
  FROM auth_tenant_role_permission_ceiling c
  LEFT JOIN company_team_invitation_permissions selected
    ON selected.invitation_id = binding_record.invitation_id
   AND selected.membership_role = binding_record.membership_role
   AND selected.permission_key = c.permission_key
  WHERE c.membership_role = binding_record.membership_role
    AND selected.permission_key IS NULL;

  IF binding_record.initial_assignment_id IS NOT NULL THEN
    INSERT INTO company_team_unit_assignments (
      assignment_id, tenant_id, membership_id, site_id, department_id,
      assigned_by_membership_id, assigned_at
    ) VALUES (
      binding_record.initial_assignment_id, binding_record.tenant_id,
      binding_record.membership_id, binding_record.site_id, binding_record.department_id,
      binding_record.invited_by_membership_id, NEW.accepted_at
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_team_activate_membership ON auth_staff_invitations;
CREATE TRIGGER company_team_activate_membership
AFTER UPDATE OF invitation_status ON auth_staff_invitations
FOR EACH ROW EXECUTE FUNCTION hse_activate_company_team_membership();
