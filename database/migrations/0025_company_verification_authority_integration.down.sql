-- Logical rollback to the accepted pre-M1.08 secure-file and audit authority.

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
      'worker_identity.worker_id.issued'
    )
  );

ALTER TABLE platform_audit_events
  DROP CONSTRAINT IF EXISTS platform_audit_events_target_type_check;
ALTER TABLE platform_audit_events
  ADD CONSTRAINT platform_audit_events_target_type_check CHECK (
    target_type IN (
      'account',
      'authentication',
      'session',
      'invitation',
      'mfa_factor',
      'portal',
      'tenant',
      'membership',
      'resource',
      'job',
      'notification',
      'email_delivery',
      'secure_file',
      'worker_identity',
      'platform'
    )
  );

CREATE OR REPLACE FUNCTION platform_secure_file_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eligible_owner BOOLEAN;
BEGIN
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

  IF NEW.owner_role = 'company' AND NOT EXISTS (
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
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Company secure file ownership requires the active trusted tenant membership.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_verification_secure_file_authority_immutable
  ON company_verification_secure_file_authorities;
DROP TRIGGER IF EXISTS company_verification_secure_file_authority_validate
  ON company_verification_secure_file_authorities;
DROP FUNCTION IF EXISTS company_verification_secure_file_authority_reject_mutation();
DROP FUNCTION IF EXISTS company_verification_secure_file_authority_validate_insert();
DROP TABLE IF EXISTS company_verification_secure_file_authorities;
