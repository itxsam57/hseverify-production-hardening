-- Cross-milestone secure-file authority compatibility envelope.
--
-- M1.08 introduced an exact immutable Company-verification reservation authority
-- so a pending Company tenant can upload evidence required to become verified.
-- M1.12 later extended the same insert trigger for the non-interactive public
-- concern service principal. That replacement must preserve, not narrow, the
-- already-accepted M1.08 Company application authority.
--
-- This forward migration composes every legitimate secure-file ownership mode:
--   1. normal active account ownership;
--   2. active Company tenant membership;
--   3. exact pending/active Company-verification application authority; and
--   4. the fixed non-interactive public-concern service principal.
-- Historical migrations remain immutable.

CREATE OR REPLACE FUNCTION platform_secure_file_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eligible_owner BOOLEAN;
  active_company_scope BOOLEAN := FALSE;
  application_scope BOOLEAN := FALSE;
BEGIN
  IF NEW.owner_account_id = 'account_public_concern_intake_system' THEN
    IF NEW.owner_role <> 'root'
       OR NEW.tenant_id IS NOT NULL
       OR NEW.membership_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Public concern secure file ownership is invalid.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth_accounts AS accounts
    JOIN auth_account_roles AS roles
      ON roles.account_id = accounts.account_id
     AND roles.role = NEW.owner_role
    WHERE accounts.account_id = NEW.owner_account_id
      AND accounts.account_status = 'active'
  ) INTO eligible_owner;

  IF NOT eligible_owner THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Secure file owner must be an active account with the assigned role.';
  END IF;

  IF NEW.owner_role = 'company' THEN
    SELECT EXISTS (
      SELECT 1
      FROM auth_tenant_memberships AS memberships
      JOIN platform_tenants AS tenants
        ON tenants.tenant_id = memberships.tenant_id
      WHERE memberships.membership_id = NEW.membership_id
        AND memberships.tenant_id = NEW.tenant_id
        AND memberships.account_id = NEW.owner_account_id
        AND memberships.portal_role = 'company'
        AND memberships.membership_status = 'active'
        AND tenants.tenant_status = 'active'
    ) INTO active_company_scope;

    IF NOT active_company_scope THEN
      SELECT EXISTS (
        SELECT 1
        FROM company_verification_secure_file_authorities AS authority
        JOIN company_verification_cases AS cases
          ON cases.case_id = authority.case_id
         AND cases.tenant_id = authority.tenant_id
        JOIN company_verification_versions AS versions
          ON versions.version_id = authority.version_id
         AND versions.case_id = cases.case_id
         AND versions.version_id = cases.current_version_id
        JOIN auth_tenant_memberships AS memberships
          ON memberships.membership_id = authority.membership_id
         AND memberships.tenant_id = authority.tenant_id
         AND memberships.account_id = authority.owner_account_id
         AND memberships.portal_role = 'company'
        JOIN platform_tenants AS tenants
          ON tenants.tenant_id = memberships.tenant_id
        WHERE authority.reservation_key = NEW.reservation_key
          AND authority.owner_account_id = NEW.owner_account_id
          AND authority.tenant_id = NEW.tenant_id
          AND authority.membership_id = NEW.membership_id
          AND cases.case_status = 'draft'
          AND versions.version_status = 'draft'
          AND memberships.membership_status = 'active'
          AND memberships.membership_role IN ('owner', 'admin')
          AND tenants.tenant_status IN ('pending', 'active')
      ) INTO application_scope;

      IF NOT application_scope THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'Company secure file ownership requires the active trusted tenant membership or an exact Company verification authority claim.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
