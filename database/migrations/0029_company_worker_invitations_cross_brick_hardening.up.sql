-- M1.10 hardening: retained workforce history must not own hard foreign-key
-- dependencies on reversible lower bricks. Cross-brick integrity remains
-- fail-closed at mutation time through database triggers plus the live service
-- authorization/verification guards. Internal M1.10 invitation/code link FKs
-- remain hard constraints.

ALTER TABLE company_worker_invitations
  DROP CONSTRAINT IF EXISTS company_worker_invitations_tenant_id_fkey,
  DROP CONSTRAINT IF EXISTS company_worker_invitations_invited_by_membership_id_fkey,
  DROP CONSTRAINT IF EXISTS company_worker_invitations_accepted_by_worker_account_id_fkey,
  DROP CONSTRAINT IF EXISTS company_worker_invitation_site_fk,
  DROP CONSTRAINT IF EXISTS company_worker_invitation_department_fk;

ALTER TABLE company_registration_codes
  DROP CONSTRAINT IF EXISTS company_registration_codes_tenant_id_fkey,
  DROP CONSTRAINT IF EXISTS company_registration_codes_created_by_membership_id_fkey,
  DROP CONSTRAINT IF EXISTS company_registration_code_site_fk,
  DROP CONSTRAINT IF EXISTS company_registration_code_department_fk;

ALTER TABLE company_worker_links
  DROP CONSTRAINT IF EXISTS company_worker_links_tenant_id_fkey,
  DROP CONSTRAINT IF EXISTS company_worker_links_worker_account_id_fkey,
  DROP CONSTRAINT IF EXISTS company_worker_links_permanent_worker_id_fkey,
  DROP CONSTRAINT IF EXISTS company_worker_links_requested_by_membership_id_fkey,
  DROP CONSTRAINT IF EXISTS company_worker_link_site_fk,
  DROP CONSTRAINT IF EXISTS company_worker_link_department_fk;

CREATE OR REPLACE FUNCTION hse_validate_company_worker_invitation_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform_tenants AS tenants
    WHERE tenants.tenant_id = NEW.tenant_id
      AND tenants.tenant_type = 'company'
      AND tenants.tenant_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company workforce tenant is unavailable.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth_tenant_memberships AS memberships
    WHERE memberships.membership_id = NEW.invited_by_membership_id
      AND memberships.tenant_id = NEW.tenant_id
      AND memberships.portal_role = 'company'
  ) THEN
    RAISE EXCEPTION 'Company workforce membership is unavailable.' USING ERRCODE = '23514';
  END IF;

  IF NEW.accepted_by_worker_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM auth_accounts AS accounts
    JOIN auth_account_roles AS roles
      ON roles.account_id = accounts.account_id
     AND roles.role = 'worker'
    WHERE accounts.account_id = NEW.accepted_by_worker_account_id
      AND accounts.account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company workforce accepted Worker is unavailable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_worker_invitation_authority_guard
  ON company_worker_invitations;
CREATE TRIGGER company_worker_invitation_authority_guard
BEFORE INSERT OR UPDATE OF tenant_id, invited_by_membership_id, accepted_by_worker_account_id
ON company_worker_invitations
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_worker_invitation_authority();

CREATE OR REPLACE FUNCTION hse_validate_company_registration_code_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform_tenants AS tenants
    WHERE tenants.tenant_id = NEW.tenant_id
      AND tenants.tenant_type = 'company'
      AND tenants.tenant_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company workforce tenant is unavailable.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth_tenant_memberships AS memberships
    WHERE memberships.membership_id = NEW.created_by_membership_id
      AND memberships.tenant_id = NEW.tenant_id
      AND memberships.portal_role = 'company'
  ) THEN
    RAISE EXCEPTION 'Company workforce membership is unavailable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_registration_code_authority_guard
  ON company_registration_codes;
CREATE TRIGGER company_registration_code_authority_guard
BEFORE INSERT OR UPDATE OF tenant_id, created_by_membership_id
ON company_registration_codes
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_registration_code_authority();

CREATE OR REPLACE FUNCTION hse_validate_company_worker_link_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform_tenants AS tenants
    WHERE tenants.tenant_id = NEW.tenant_id
      AND tenants.tenant_type = 'company'
      AND tenants.tenant_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company workforce tenant is unavailable.' USING ERRCODE = '23514';
  END IF;

  IF NEW.requested_by_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM auth_tenant_memberships AS memberships
    WHERE memberships.membership_id = NEW.requested_by_membership_id
      AND memberships.tenant_id = NEW.tenant_id
      AND memberships.portal_role = 'company'
  ) THEN
    RAISE EXCEPTION 'Company workforce membership is unavailable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_worker_link_authority_guard
  ON company_worker_links;
CREATE TRIGGER company_worker_link_authority_guard
BEFORE INSERT OR UPDATE OF tenant_id, requested_by_membership_id
ON company_worker_links
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_worker_link_authority();
