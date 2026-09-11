-- M1.08 durable integration with accepted M1.05/M1.06 authority.
--
-- The accepted M1.06 secure-file table and repository remain schema-compatible.
-- A pending Company may reserve verification evidence only when M1.08 has first
-- written an immutable, server-derived authority claim for the exact reservation
-- key. The existing active-tenant Company path remains unchanged.

CREATE TABLE IF NOT EXISTS company_verification_secure_file_authorities (
  reservation_key TEXT PRIMARY KEY CHECK (reservation_key ~ '^[a-f0-9]{64}$'),
  case_id TEXT NOT NULL
    REFERENCES company_verification_cases(case_id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL
    REFERENCES company_verification_versions(version_id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL CHECK (char_length(owner_account_id) BETWEEN 8 AND 160),
  tenant_id TEXT NOT NULL CHECK (char_length(tenant_id) BETWEEN 8 AND 160),
  membership_id TEXT NOT NULL CHECK (char_length(membership_id) BETWEEN 8 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_verification_secure_file_authority_case_version_unique
    UNIQUE (case_id, version_id, reservation_key)
);

CREATE INDEX IF NOT EXISTS company_verification_secure_file_authority_scope_idx
  ON company_verification_secure_file_authorities (
    tenant_id,
    owner_account_id,
    membership_id,
    created_at
  );

CREATE OR REPLACE FUNCTION company_verification_secure_file_authority_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM company_verification_cases AS cases
    JOIN company_verification_versions AS versions
      ON versions.version_id = cases.current_version_id
     AND versions.case_id = cases.case_id
    JOIN auth_tenant_memberships AS memberships
      ON memberships.membership_id = NEW.membership_id
     AND memberships.tenant_id = NEW.tenant_id
     AND memberships.account_id = NEW.owner_account_id
     AND memberships.portal_role = 'company'
    JOIN platform_tenants AS tenants
      ON tenants.tenant_id = memberships.tenant_id
    WHERE cases.case_id = NEW.case_id
      AND cases.tenant_id = NEW.tenant_id
      AND versions.version_id = NEW.version_id
      AND cases.case_status = 'draft'
      AND versions.version_status = 'draft'
      AND memberships.membership_status = 'active'
      AND memberships.membership_role IN ('owner', 'admin')
      AND tenants.tenant_status IN ('pending', 'active')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Company verification secure-file authority requires the live draft case and manager.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_verification_secure_file_authority_validate
  ON company_verification_secure_file_authorities;
CREATE TRIGGER company_verification_secure_file_authority_validate
BEFORE INSERT ON company_verification_secure_file_authorities
FOR EACH ROW
EXECUTE FUNCTION company_verification_secure_file_authority_validate_insert();

CREATE OR REPLACE FUNCTION company_verification_secure_file_authority_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Company verification secure-file authority history is immutable.';
END;
$$;

DROP TRIGGER IF EXISTS company_verification_secure_file_authority_immutable
  ON company_verification_secure_file_authorities;
CREATE TRIGGER company_verification_secure_file_authority_immutable
BEFORE UPDATE OR DELETE ON company_verification_secure_file_authorities
FOR EACH ROW
EXECUTE FUNCTION company_verification_secure_file_authority_reject_mutation();

CREATE OR REPLACE FUNCTION platform_secure_file_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eligible_owner BOOLEAN;
  active_company_scope BOOLEAN := FALSE;
  application_scope BOOLEAN := FALSE;
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

-- Extend the append-only audit vocabulary for the M1.08 lifecycle.
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
      'company_verification.status.changed'
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
      'company_verification',
      'platform'
    )
  );
