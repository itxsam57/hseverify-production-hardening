-- M1.09 Company organization/team hardening and audit integration.
-- This migration extends the accepted M1.05 audit vocabulary without rewriting
-- historical migrations and adds database invariants for Company Team lifecycle.

ALTER TABLE platform_audit_events
  DROP CONSTRAINT IF EXISTS platform_audit_events_action_key_check;
ALTER TABLE platform_audit_events
  ADD CONSTRAINT platform_audit_events_action_key_check CHECK (
    action_key IN (
      'authentication.registration.started',
      'authentication.otp.issued',
      'authentication.otp.failed',
      'authentication.otp.verified',
      'authentication.password.created',
      'authentication.password_reset.requested',
      'authentication.password_reset.completed',
      'authentication.login.failed',
      'authentication.login.succeeded',
      'authentication.logout',
      'authentication.session.revoked',
      'authentication.account.locked',
      'authentication.account.unlocked',
      'authentication.invitation.created',
      'authentication.invitation.accepted',
      'authentication.mfa.enrolled',
      'authentication.mfa.failed',
      'authentication.mfa.succeeded',
      'authorization.access.denied',
      'outbox.job.enqueued',
      'outbox.job.claimed',
      'outbox.job.lease_reclaimed',
      'outbox.job.succeeded',
      'outbox.job.retry_scheduled',
      'outbox.job.terminal_failed',
      'notification.projected',
      'notification.read',
      'notification.deep_link.denied',
      'email.delivery.queued',
      'email.delivery.attempt.started',
      'email.delivery.delivered',
      'email.delivery.retry_scheduled',
      'email.delivery.terminal_failed',
      'secure_file.quarantined',
      'secure_file.scan.queued',
      'secure_file.scan.available',
      'secure_file.scan.unsafe',
      'secure_file.scan.failed',
      'secure_file.access.authorized',
      'secure_file.access.served',
      'worker_identity.created',
      'worker_identity.status.changed',
      'worker_identity.duplicate.evaluated',
      'worker_identity.duplicate.disposition.recorded',
      'worker_identity.worker_id.issued',
      'company_verification.updated',
      'company_verification.evidence.bound',
      'company_verification.submitted',
      'company_verification.withdrawn',
      'company_verification.status.changed',
      'company_organization.created',
      'company_organization.updated',
      'company_organization.archived',
      'company_organization.restored',
      'company_team.invitation.created',
      'company_team.invitation.revoked',
      'company_team.membership.updated',
      'company_team.membership.suspended',
      'company_team.membership.reactivated',
      'company_team.membership.revoked'
    )
  );

-- The 0026 archive trigger is shared by sites and departments. PostgreSQL/PGlite
-- record-field resolution must never inspect a column that does not exist on the
-- triggering table, so dispatch by table first and only then touch table-specific
-- status/id fields. Archive still ends active assignments; restore never recreates them.
CREATE OR REPLACE FUNCTION hse_archive_company_unit_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'company_sites' THEN
    IF OLD.site_status = 'active' AND NEW.site_status = 'archived' THEN
      UPDATE company_team_unit_assignments
      SET ended_at = COALESCE(ended_at, NEW.archived_at),
          ended_reason = COALESCE(ended_reason, 'Site archived')
      WHERE tenant_id = NEW.tenant_id
        AND site_id = NEW.site_id
        AND ended_at IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'company_departments' THEN
    IF OLD.department_status = 'active' AND NEW.department_status = 'archived' THEN
      UPDATE company_team_unit_assignments
      SET ended_at = COALESCE(ended_at, NEW.archived_at),
          ended_reason = COALESCE(ended_reason, 'Department archived')
      WHERE tenant_id = NEW.tenant_id
        AND department_id = NEW.department_id
        AND ended_at IS NULL;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected Company organization archive trigger source';
  END IF;
  RETURN NEW;
END;
$$;

-- A Company may never lose its final active owner through a direct membership
-- mutation. Service-level authority checks are still required; this is the
-- database invariant beneath them.
CREATE OR REPLACE FUNCTION hse_guard_company_team_owner_continuity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.portal_role = 'company'
     AND OLD.membership_role = 'owner'
     AND OLD.membership_status = 'active'
     AND (
       NEW.membership_role <> 'owner'
       OR NEW.membership_status <> 'active'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM auth_tenant_memberships AS other_owner
       WHERE other_owner.tenant_id = OLD.tenant_id
         AND other_owner.membership_id <> OLD.membership_id
         AND other_owner.portal_role = 'company'
         AND other_owner.membership_role = 'owner'
         AND other_owner.membership_status = 'active'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A Company must retain at least one active owner.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_team_owner_continuity_guard
  ON auth_tenant_memberships;
CREATE TRIGGER company_team_owner_continuity_guard
BEFORE UPDATE OF membership_role, membership_status
ON auth_tenant_memberships
FOR EACH ROW
EXECUTE FUNCTION hse_guard_company_team_owner_continuity();

-- Historical assignment rows must remain endable after a membership is
-- suspended/revoked. Only a still-active assignment requires an active target,
-- active assigning membership and active unit.
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
    ) THEN
      RAISE EXCEPTION 'Archived Company site cannot receive active assignment';
    END IF;

    IF NEW.department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM company_departments AS departments
      WHERE departments.tenant_id = NEW.tenant_id
        AND departments.department_id = NEW.department_id
        AND departments.department_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Archived Company department cannot receive active assignment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Deactivation is history-preserving: active unit assignment rows are ended,
-- not deleted, and reactivation never recreates them implicitly.
CREATE OR REPLACE FUNCTION hse_end_company_team_assignments_on_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  ended_timestamp TIMESTAMPTZ;
  ended_reason_value TEXT;
BEGIN
  IF OLD.portal_role <> 'company'
     OR OLD.membership_status <> 'active'
     OR NEW.membership_status NOT IN ('suspended', 'revoked') THEN
    RETURN NEW;
  END IF;

  ended_timestamp := COALESCE(NEW.suspended_at, NEW.revoked_at, CURRENT_TIMESTAMP);
  ended_reason_value := CASE
    WHEN NEW.membership_status = 'suspended' THEN 'Membership suspended'
    ELSE 'Membership revoked'
  END;

  UPDATE company_team_unit_assignments
  SET ended_at = COALESCE(ended_at, ended_timestamp),
      ended_reason = COALESCE(ended_reason, ended_reason_value)
  WHERE tenant_id = NEW.tenant_id
    AND membership_id = NEW.membership_id
    AND ended_at IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_team_end_assignments_on_deactivation
  ON auth_tenant_memberships;
CREATE TRIGGER company_team_end_assignments_on_deactivation
AFTER UPDATE OF membership_status
ON auth_tenant_memberships
FOR EACH ROW
EXECUTE FUNCTION hse_end_company_team_assignments_on_deactivation();

-- Invitation scope/permission selections are the immutable provenance of the
-- membership activated by the shared M1.03 password/TOTP enrollment path.
CREATE OR REPLACE FUNCTION hse_reject_company_team_invitation_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Company Team invitation binding history is immutable.';
END;
$$;

DROP TRIGGER IF EXISTS company_team_invitation_binding_immutable
  ON company_team_invitation_bindings;
CREATE TRIGGER company_team_invitation_binding_immutable
BEFORE UPDATE OR DELETE ON company_team_invitation_bindings
FOR EACH ROW
EXECUTE FUNCTION hse_reject_company_team_invitation_history_mutation();

DROP TRIGGER IF EXISTS company_team_invitation_permission_immutable
  ON company_team_invitation_permissions;
CREATE TRIGGER company_team_invitation_permission_immutable
BEFORE UPDATE OR DELETE ON company_team_invitation_permissions
FOR EACH ROW
EXECUTE FUNCTION hse_reject_company_team_invitation_history_mutation();
