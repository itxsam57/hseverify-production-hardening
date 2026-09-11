-- M1.07 Subunit 1: Worker Identity Domain, Versioned Persistence and State Machine.
-- Identity is deliberately separate from the general Worker profile JSON store.
-- Sensitive evidence bytes remain in the accepted M1.06 private object domain.
--
-- REG-073: Worker identity/account references are durable historical identifiers,
-- not foreign keys to rollback-owned authentication tables. M1.03 already has an
-- accepted independent rollback contract beneath later layers. Live identity
-- creation and every repository command validate the active Worker account,
-- role and session transactionally instead of coupling immutable identity history
-- to the physical lifetime of auth_accounts.

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
      'worker_identity.status.changed'
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

CREATE TABLE IF NOT EXISTS worker_identities (
  identity_id TEXT PRIMARY KEY CHECK (
    identity_id ~ '^worker_identity_[A-Za-z0-9_-]{24}$'
  ),
  worker_account_id TEXT NOT NULL UNIQUE CHECK (
    char_length(worker_account_id) BETWEEN 8 AND 160
  ),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    lifecycle_status IN (
      'draft',
      'submitted',
      'automated_checks',
      'manual_review',
      'more_info',
      'rejected',
      'escalated',
      'verified',
      'correction_pending',
      'expired_document',
      'suspended',
      'reinstated',
      'closed',
      'withdrawn'
    )
  ),
  current_version_number INTEGER NOT NULL DEFAULT 1 CHECK (
    current_version_number BETWEEN 1 AND 10000
  ),
  lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_identities_worker_account_unique_idx
  ON worker_identities (worker_account_id);

CREATE INDEX IF NOT EXISTS worker_identities_status_idx
  ON worker_identities (lifecycle_status, updated_at, identity_id);

CREATE TABLE IF NOT EXISTS worker_identity_versions (
  identity_version_id TEXT PRIMARY KEY CHECK (
    identity_version_id ~ '^identity_version_[A-Za-z0-9_-]{24}$'
  ),
  identity_id TEXT NOT NULL
    REFERENCES worker_identities(identity_id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number BETWEEN 1 AND 10000),
  parent_version_id TEXT NULL
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  version_kind TEXT NOT NULL CHECK (version_kind IN ('initial', 'correction')),
  version_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    version_status IN ('draft', 'submitted')
  ),
  created_by_account_id TEXT NOT NULL CHECK (
    char_length(created_by_account_id) BETWEEN 8 AND 160
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMPTZ NULL,
  CONSTRAINT worker_identity_versions_identity_number_unique
    UNIQUE (identity_id, version_number),
  CONSTRAINT worker_identity_versions_submission_shape CHECK (
    (version_status = 'draft' AND submitted_at IS NULL) OR
    (version_status = 'submitted' AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT worker_identity_versions_lineage_shape CHECK (
    (
      version_number = 1 AND
      version_kind = 'initial' AND
      parent_version_id IS NULL
    ) OR (
      version_number > 1 AND
      version_kind = 'correction' AND
      parent_version_id IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS worker_identity_versions_identity_idx
  ON worker_identity_versions (identity_id, version_number DESC);

CREATE OR REPLACE FUNCTION worker_identity_transition_allowed(
  old_status TEXT,
  new_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_status
    WHEN 'draft' THEN new_status IN ('submitted')
    WHEN 'submitted' THEN new_status IN ('automated_checks', 'withdrawn')
    WHEN 'automated_checks' THEN new_status IN ('manual_review', 'more_info', 'rejected')
    WHEN 'manual_review' THEN new_status IN ('verified', 'more_info', 'rejected', 'escalated')
    WHEN 'more_info' THEN new_status IN ('manual_review')
    WHEN 'verified' THEN new_status IN ('correction_pending', 'expired_document', 'suspended')
    WHEN 'correction_pending' THEN new_status IN ('verified')
    WHEN 'suspended' THEN new_status IN ('verified', 'reinstated', 'closed')
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth_accounts AS accounts
    JOIN auth_account_roles AS roles
      ON roles.account_id = accounts.account_id
     AND roles.role = 'worker'
    WHERE accounts.account_id = NEW.worker_account_id
      AND accounts.account_status = 'active'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity owner must be an active Worker account.';
  END IF;

  IF NEW.lifecycle_status <> 'draft' OR
     NEW.current_version_number <> 1 OR
     NEW.lock_version <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'New Worker identity must start as draft version 1.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.identity_id IS DISTINCT FROM OLD.identity_id OR
     NEW.worker_account_id IS DISTINCT FROM OLD.worker_account_id OR
     NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity ownership and creation provenance are immutable.';
  END IF;

  IF NEW.current_version_number IS DISTINCT FROM OLD.current_version_number THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity version advancement is not available in this foundation subunit.';
  END IF;

  IF NEW.lock_version <> OLD.lock_version + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Worker identity optimistic lock version is invalid.';
  END IF;

  IF NOT worker_identity_transition_allowed(
    OLD.lifecycle_status,
    NEW.lifecycle_status
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity lifecycle transition is invalid.';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Worker identity history is immutable and cannot be deleted.';
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_version_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  identity_owner_account_id TEXT;
  identity_status TEXT;
  identity_current_version INTEGER;
  parent_identity_id TEXT;
  parent_version_number INTEGER;
  parent_version_status TEXT;
BEGIN
  SELECT worker_account_id, lifecycle_status, current_version_number
  INTO identity_owner_account_id, identity_status, identity_current_version
  FROM worker_identities
  WHERE identity_id = NEW.identity_id;

  IF identity_owner_account_id IS NULL OR
     NEW.created_by_account_id IS DISTINCT FROM identity_owner_account_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity version creator must own the identity.';
  END IF;

  IF NEW.version_number = 1 THEN
    IF identity_status <> 'draft' OR identity_current_version <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Initial Worker identity version can only be created for a new draft identity.';
    END IF;
    RETURN NEW;
  END IF;

  IF identity_status <> 'correction_pending' OR
     identity_current_version <> NEW.version_number - 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity correction lineage is invalid.';
  END IF;

  SELECT identity_id, version_number, version_status
  INTO parent_identity_id, parent_version_number, parent_version_status
  FROM worker_identity_versions
  WHERE identity_version_id = NEW.parent_version_id;

  IF parent_identity_id IS NULL OR
     parent_identity_id <> NEW.identity_id OR
     parent_version_number <> NEW.version_number - 1 OR
     parent_version_status <> 'submitted' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity correction lineage is invalid.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_version_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.version_status = 'submitted' OR OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Submitted Worker identity versions are immutable.';
  END IF;

  IF NEW.identity_version_id IS DISTINCT FROM OLD.identity_version_id OR
     NEW.identity_id IS DISTINCT FROM OLD.identity_id OR
     NEW.version_number IS DISTINCT FROM OLD.version_number OR
     NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id OR
     NEW.version_kind IS DISTINCT FROM OLD.version_kind OR
     NEW.created_by_account_id IS DISTINCT FROM OLD.created_by_account_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity version lineage is immutable.';
  END IF;

  IF OLD.version_status <> 'draft' OR
     NEW.version_status <> 'submitted' OR
     NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity version transition is invalid.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_identities_validate_insert
  ON worker_identities;
CREATE TRIGGER worker_identities_validate_insert
BEFORE INSERT ON worker_identities
FOR EACH ROW
EXECUTE FUNCTION worker_identity_validate_insert();

DROP TRIGGER IF EXISTS worker_identities_guard_update
  ON worker_identities;
CREATE TRIGGER worker_identities_guard_update
BEFORE UPDATE ON worker_identities
FOR EACH ROW
EXECUTE FUNCTION worker_identity_guard_update();

DROP TRIGGER IF EXISTS worker_identities_no_delete
  ON worker_identities;
CREATE TRIGGER worker_identities_no_delete
BEFORE DELETE ON worker_identities
FOR EACH ROW
EXECUTE FUNCTION worker_identity_reject_delete();

DROP TRIGGER IF EXISTS worker_identity_versions_validate_insert
  ON worker_identity_versions;
CREATE TRIGGER worker_identity_versions_validate_insert
BEFORE INSERT ON worker_identity_versions
FOR EACH ROW
EXECUTE FUNCTION worker_identity_version_validate_insert();

DROP TRIGGER IF EXISTS worker_identity_versions_guard_update
  ON worker_identity_versions;
CREATE TRIGGER worker_identity_versions_guard_update
BEFORE UPDATE ON worker_identity_versions
FOR EACH ROW
EXECUTE FUNCTION worker_identity_version_guard_update();

DROP TRIGGER IF EXISTS worker_identity_versions_no_delete
  ON worker_identity_versions;
CREATE TRIGGER worker_identity_versions_no_delete
BEFORE DELETE ON worker_identity_versions
FOR EACH ROW
EXECUTE FUNCTION worker_identity_reject_delete();
