-- M1.09.03 genuine concurrent Company Team placement against archived site/department.
-- Prior 0026 invitation-binding and 0027 active-assignment trigger validations used
-- unlocked MVCC status reads. A second transaction could insert a new active
-- Team unit assignment after the archive's sweep but before archive commit.
-- With the active unit row locked FOR SHARE, the winner serializes at the
-- site/department, not at the invitation/assignment row that may not exist.
-- Preserve all 0026/0027 tenant, role, historical assignment and inviter
-- validations, changing only the active-unit checks to row-locking reads.
-- No mutation of previously recorded migration checksums or historical events.

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
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Archived or unavailable Company site cannot receive assignment';
  END IF;
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_departments d
    WHERE d.tenant_id = NEW.tenant_id AND d.department_id = NEW.department_id AND d.department_status = 'active'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Archived or unavailable Company department cannot receive assignment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hse_validate_company_team_unit_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth_tenant_memberships AS target
    WHERE target.membership_id = NEW.membership_id
      AND target.tenant_id = NEW.tenant_id
      AND target.portal_role = 'company'
  ) THEN
    RAISE EXCEPTION 'Company Team assignment target is outside the tenant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth_tenant_memberships AS assigner
    WHERE assigner.membership_id = NEW.assigned_by_membership_id
      AND assigner.tenant_id = NEW.tenant_id
      AND assigner.portal_role = 'company'
  ) THEN
    RAISE EXCEPTION 'Company Team assignment authority is outside the tenant.';
  END IF;

  IF NEW.ended_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM auth_tenant_memberships AS target
      JOIN platform_tenants AS tenants
        ON tenants.tenant_id = target.tenant_id
      WHERE target.membership_id = NEW.membership_id
        AND target.tenant_id = NEW.tenant_id
        AND target.portal_role = 'company'
        AND target.membership_status = 'active'
        AND tenants.tenant_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Inactive Company membership cannot receive unit assignment';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM auth_tenant_memberships AS assigner
      WHERE assigner.membership_id = NEW.assigned_by_membership_id
        AND assigner.tenant_id = NEW.tenant_id
        AND assigner.portal_role = 'company'
        AND assigner.membership_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Inactive Company membership cannot assign a unit';
    END IF;

    IF NEW.site_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM company_sites AS sites
      WHERE sites.tenant_id = NEW.tenant_id
        AND sites.site_id = NEW.site_id
        AND sites.site_status = 'active'
      FOR SHARE
    ) THEN
      RAISE EXCEPTION 'Archived Company site cannot receive active assignment';
    END IF;

    IF NEW.department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM company_departments AS departments
      WHERE departments.tenant_id = NEW.tenant_id
        AND departments.department_id = NEW.department_id
        AND departments.department_status = 'active'
      FOR SHARE
    ) THEN
      RAISE EXCEPTION 'Archived Company department cannot receive active assignment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Fail closed if earlier flawed deployments already persisted a current Team
-- assignment to a fully archived unit. This is evidence requiring an audited
-- owner/reviewer reconciliation, never an unannounced automatic reassignment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM company_team_unit_assignments x
    JOIN company_sites s ON s.tenant_id=x.tenant_id AND s.site_id=x.site_id
    WHERE x.ended_at IS NULL AND s.site_status='archived'
  ) OR EXISTS (
    SELECT 1 FROM company_team_unit_assignments x
    JOIN company_departments d ON d.tenant_id=x.tenant_id AND d.department_id=x.department_id
    WHERE x.ended_at IS NULL AND d.department_status='archived'
  ) THEN
    RAISE EXCEPTION 'Existing active Company Team placement against archived unit requires audited reconciliation before 0132.' USING ERRCODE='23514';
  END IF;
END;
$$;
