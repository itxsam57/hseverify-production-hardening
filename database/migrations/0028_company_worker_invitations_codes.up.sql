-- M1.10 Worker invitations, Company registration codes and consent-based
-- Company↔Worker linking. This migration is monotonic: accepted security and
-- history invariants remain installed even if the migration ledger is rolled back.

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
      'company_team.membership.revoked',
      'company_workforce.invitation.created',
      'company_workforce.invitation.resent',
      'company_workforce.invitation.revoked',
      'company_workforce.invitation.accepted',
      'company_workforce.code.created',
      'company_workforce.code.revoked',
      'company_workforce.code.redeemed',
      'company_workforce.link.requested',
      'company_workforce.link.accepted',
      'company_workforce.link.revoked'
    )
  );

CREATE TABLE IF NOT EXISTS company_worker_invitations (
  invitation_id TEXT PRIMARY KEY CHECK (
    invitation_id ~ '^worker_invitation_[A-Za-z0-9_-]{24}$'
  ),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE RESTRICT,
  email_normalized TEXT NOT NULL CHECK (
    char_length(email_normalized) BETWEEN 3 AND 254 AND email_normalized = lower(email_normalized)
  ),
  token_hash TEXT NOT NULL UNIQUE,
  invitation_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    invitation_status IN ('pending', 'accepted', 'revoked', 'expired')
  ),
  site_id TEXT NULL,
  department_id TEXT NULL,
  payment_responsibility TEXT NOT NULL DEFAULT 'worker' CHECK (
    payment_responsibility IN ('company', 'worker')
  ),
  assessment_reference TEXT NULL CHECK (
    assessment_reference IS NULL OR char_length(assessment_reference) BETWEEN 1 AND 120
  ),
  invited_by_membership_id TEXT NOT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  accepted_by_worker_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  resend_count INTEGER NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 50),
  resend_available_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  expired_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_worker_invitation_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT company_worker_invitation_resend_check CHECK (
    resend_available_at >= created_at AND resend_available_at < expires_at
  ),
  CONSTRAINT company_worker_invitation_state_check CHECK (
    (invitation_status = 'pending' AND accepted_by_worker_account_id IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expired_at IS NULL)
    OR (invitation_status = 'accepted' AND accepted_by_worker_account_id IS NOT NULL AND accepted_at IS NOT NULL AND revoked_at IS NULL AND expired_at IS NULL)
    OR (invitation_status = 'revoked' AND accepted_by_worker_account_id IS NULL AND accepted_at IS NULL AND revoked_at IS NOT NULL AND expired_at IS NULL)
    OR (invitation_status = 'expired' AND accepted_by_worker_account_id IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expired_at IS NOT NULL)
  ),
  CONSTRAINT company_worker_invitation_site_fk
    FOREIGN KEY (tenant_id, site_id)
    REFERENCES company_sites (tenant_id, site_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_worker_invitation_department_fk
    FOREIGN KEY (tenant_id, department_id)
    REFERENCES company_departments (tenant_id, department_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS company_worker_pending_email_idx
  ON company_worker_invitations (tenant_id, email_normalized)
  WHERE invitation_status = 'pending';
CREATE INDEX IF NOT EXISTS company_worker_invitation_tenant_status_idx
  ON company_worker_invitations (tenant_id, invitation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS company_worker_invitation_token_idx
  ON company_worker_invitations (token_hash, invitation_status, expires_at);

CREATE TABLE IF NOT EXISTS company_registration_codes (
  code_id TEXT PRIMARY KEY CHECK (
    code_id ~ '^company_code_[A-Za-z0-9_-]{24}$'
  ),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE RESTRICT,
  code_hash TEXT NOT NULL UNIQUE,
  code_status TEXT NOT NULL DEFAULT 'active' CHECK (
    code_status IN ('active', 'revoked', 'expired', 'exhausted')
  ),
  usage_limit INTEGER NOT NULL CHECK (usage_limit BETWEEN 1 AND 10000),
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0 AND usage_count <= usage_limit),
  site_id TEXT NULL,
  department_id TEXT NULL,
  payment_responsibility TEXT NOT NULL DEFAULT 'worker' CHECK (
    payment_responsibility IN ('company', 'worker')
  ),
  assessment_reference TEXT NULL CHECK (
    assessment_reference IS NULL OR char_length(assessment_reference) BETWEEN 1 AND 120
  ),
  created_by_membership_id TEXT NOT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  exhausted_at TIMESTAMPTZ NULL,
  expired_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_registration_code_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT company_registration_code_state_check CHECK (
    (code_status = 'active' AND revoked_at IS NULL AND exhausted_at IS NULL AND expired_at IS NULL AND usage_count < usage_limit)
    OR (code_status = 'revoked' AND revoked_at IS NOT NULL AND exhausted_at IS NULL AND expired_at IS NULL)
    OR (code_status = 'exhausted' AND revoked_at IS NULL AND exhausted_at IS NOT NULL AND expired_at IS NULL AND usage_count = usage_limit)
    OR (code_status = 'expired' AND revoked_at IS NULL AND exhausted_at IS NULL AND expired_at IS NOT NULL)
  ),
  CONSTRAINT company_registration_code_site_fk
    FOREIGN KEY (tenant_id, site_id)
    REFERENCES company_sites (tenant_id, site_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_registration_code_department_fk
    FOREIGN KEY (tenant_id, department_id)
    REFERENCES company_departments (tenant_id, department_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS company_registration_code_tenant_status_idx
  ON company_registration_codes (tenant_id, code_status, created_at DESC);
CREATE INDEX IF NOT EXISTS company_registration_code_hash_idx
  ON company_registration_codes (code_hash, code_status, expires_at);

CREATE TABLE IF NOT EXISTS company_worker_links (
  link_id TEXT PRIMARY KEY CHECK (
    link_id ~ '^company_worker_link_[A-Za-z0-9_-]{24}$'
  ),
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  permanent_worker_id TEXT NULL REFERENCES worker_identity_worker_ids(permanent_worker_id) ON DELETE RESTRICT,
  link_source TEXT NOT NULL CHECK (
    link_source IN ('invitation', 'code', 'permanent_worker_id')
  ),
  invitation_id TEXT NULL REFERENCES company_worker_invitations(invitation_id) ON DELETE RESTRICT,
  code_id TEXT NULL REFERENCES company_registration_codes(code_id) ON DELETE RESTRICT,
  link_status TEXT NOT NULL CHECK (
    link_status IN ('pending_worker_acceptance', 'active', 'revoked')
  ),
  site_id TEXT NULL,
  department_id TEXT NULL,
  payment_responsibility TEXT NOT NULL DEFAULT 'worker' CHECK (
    payment_responsibility IN ('company', 'worker')
  ),
  assessment_reference TEXT NULL CHECK (
    assessment_reference IS NULL OR char_length(assessment_reference) BETWEEN 1 AND 120
  ),
  requested_by_membership_id TEXT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  worker_accepted_at TIMESTAMPTZ NULL,
  activated_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_worker_link_source_check CHECK (
    (link_source = 'invitation' AND invitation_id IS NOT NULL AND code_id IS NULL AND permanent_worker_id IS NULL)
    OR (link_source = 'code' AND invitation_id IS NULL AND code_id IS NOT NULL AND permanent_worker_id IS NULL)
    OR (link_source = 'permanent_worker_id' AND invitation_id IS NULL AND code_id IS NULL AND permanent_worker_id IS NOT NULL)
  ),
  CONSTRAINT company_worker_link_state_check CHECK (
    (link_status = 'pending_worker_acceptance' AND worker_accepted_at IS NULL AND activated_at IS NULL AND revoked_at IS NULL)
    OR (link_status = 'active' AND worker_accepted_at IS NOT NULL AND activated_at IS NOT NULL AND revoked_at IS NULL)
    OR (link_status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT company_worker_link_site_fk
    FOREIGN KEY (tenant_id, site_id)
    REFERENCES company_sites (tenant_id, site_id)
    ON DELETE RESTRICT,
  CONSTRAINT company_worker_link_department_fk
    FOREIGN KEY (tenant_id, department_id)
    REFERENCES company_departments (tenant_id, department_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS company_worker_live_link_idx
  ON company_worker_links (tenant_id, worker_account_id)
  WHERE link_status IN ('pending_worker_acceptance', 'active');
CREATE INDEX IF NOT EXISTS company_worker_link_worker_idx
  ON company_worker_links (worker_account_id, link_status, created_at DESC);
CREATE INDEX IF NOT EXISTS company_worker_link_tenant_idx
  ON company_worker_links (tenant_id, link_status, created_at DESC);

CREATE OR REPLACE FUNCTION hse_validate_company_workforce_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_sites AS sites
    WHERE sites.tenant_id = NEW.tenant_id
      AND sites.site_id = NEW.site_id
      AND sites.site_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company workforce site is unavailable.' USING ERRCODE = '23514';
  END IF;

  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_departments AS departments
    WHERE departments.tenant_id = NEW.tenant_id
      AND departments.department_id = NEW.department_id
      AND departments.department_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company workforce department is unavailable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_worker_invitation_scope_guard ON company_worker_invitations;
CREATE TRIGGER company_worker_invitation_scope_guard
BEFORE INSERT OR UPDATE OF tenant_id, site_id, department_id
ON company_worker_invitations
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_workforce_scope();

DROP TRIGGER IF EXISTS company_registration_code_scope_guard ON company_registration_codes;
CREATE TRIGGER company_registration_code_scope_guard
BEFORE INSERT OR UPDATE OF tenant_id, site_id, department_id
ON company_registration_codes
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_workforce_scope();

DROP TRIGGER IF EXISTS company_worker_link_scope_guard ON company_worker_links;
CREATE TRIGGER company_worker_link_scope_guard
BEFORE INSERT OR UPDATE OF tenant_id, site_id, department_id
ON company_worker_links
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_workforce_scope();

CREATE OR REPLACE FUNCTION hse_validate_company_worker_link_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth_accounts AS accounts
    JOIN auth_account_roles AS roles
      ON roles.account_id = accounts.account_id AND roles.role = 'worker'
    WHERE accounts.account_id = NEW.worker_account_id
      AND accounts.account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Company workforce Worker account is unavailable.' USING ERRCODE = '23514';
  END IF;

  IF NEW.permanent_worker_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM worker_identity_worker_ids AS worker_ids
    WHERE worker_ids.permanent_worker_id = NEW.permanent_worker_id
      AND worker_ids.worker_account_id = NEW.worker_account_id
  ) THEN
    RAISE EXCEPTION 'Permanent Worker-ID does not belong to the Worker.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_worker_link_identity_guard ON company_worker_links;
CREATE TRIGGER company_worker_link_identity_guard
BEFORE INSERT OR UPDATE OF worker_account_id, permanent_worker_id
ON company_worker_links
FOR EACH ROW EXECUTE FUNCTION hse_validate_company_worker_link_identity();

CREATE OR REPLACE FUNCTION hse_guard_company_workforce_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Company workforce history is immutable.' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS company_worker_invitation_delete_guard ON company_worker_invitations;
CREATE TRIGGER company_worker_invitation_delete_guard
BEFORE DELETE ON company_worker_invitations
FOR EACH ROW EXECUTE FUNCTION hse_guard_company_workforce_history();

DROP TRIGGER IF EXISTS company_registration_code_delete_guard ON company_registration_codes;
CREATE TRIGGER company_registration_code_delete_guard
BEFORE DELETE ON company_registration_codes
FOR EACH ROW EXECUTE FUNCTION hse_guard_company_workforce_history();

DROP TRIGGER IF EXISTS company_worker_link_delete_guard ON company_worker_links;
CREATE TRIGGER company_worker_link_delete_guard
BEFORE DELETE ON company_worker_links
FOR EACH ROW EXECUTE FUNCTION hse_guard_company_workforce_history();
