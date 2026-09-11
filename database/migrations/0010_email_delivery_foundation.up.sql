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
      'email.delivery.terminal_failed'
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
      'platform'
    )
  );

ALTER TABLE platform_outbox_jobs
  DROP CONSTRAINT IF EXISTS platform_outbox_jobs_job_type_check;
ALTER TABLE platform_outbox_jobs
  ADD CONSTRAINT platform_outbox_jobs_job_type_check CHECK (
    job_type IN (
      'platform.foundation.noop',
      'notification.portal.foundation',
      'email.delivery.foundation'
    )
  );

CREATE TABLE IF NOT EXISTS platform_email_deliveries (
  delivery_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  delivery_id TEXT PRIMARY KEY CHECK (
    delivery_id ~ '^email_delivery_[A-Za-z0-9_-]{24}$'
  ),
  delivery_type TEXT NOT NULL CHECK (
    delivery_type IN ('platform.foundation.email')
  ),
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  source_job_id TEXT NOT NULL UNIQUE
    REFERENCES platform_outbox_jobs(job_id) ON DELETE RESTRICT,
  delivery_key TEXT NOT NULL UNIQUE CHECK (
    char_length(delivery_key) = 64 AND delivery_key ~ '^[a-f0-9]{64}$'
  ),
  recipient_account_id TEXT NOT NULL
    REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  recipient_role TEXT NOT NULL CHECK (
    recipient_role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  tenant_id TEXT NULL,
  membership_id TEXT NULL,
  recipient_address_hash TEXT NOT NULL CHECK (
    char_length(recipient_address_hash) = 64 AND
    recipient_address_hash ~ '^[a-f0-9]{64}$'
  ),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'processing', 'retry_wait', 'delivered', 'terminal_failed')
  ),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (
    attempt_count BETWEEN 0 AND 5
  ),
  last_result_code TEXT NULL CHECK (
    last_result_code IS NULL OR (
      char_length(last_result_code) BETWEEN 2 AND 120 AND
      last_result_code ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  last_result_summary TEXT NULL CHECK (
    last_result_summary IS NULL OR char_length(last_result_summary) BETWEEN 1 AND 240
  ),
  delivered_at TIMESTAMPTZ NULL,
  terminal_failed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT platform_email_delivery_tenant_scope_shape CHECK (
    (
      recipient_role = 'company' AND
      tenant_id IS NOT NULL AND membership_id IS NOT NULL
    ) OR (
      recipient_role <> 'company' AND
      tenant_id IS NULL AND membership_id IS NULL
    )
  ),
  CONSTRAINT platform_email_delivery_terminal_shape CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL AND terminal_failed_at IS NULL) OR
    (status = 'terminal_failed' AND delivered_at IS NULL AND terminal_failed_at IS NOT NULL) OR
    (status NOT IN ('delivered', 'terminal_failed') AND delivered_at IS NULL AND terminal_failed_at IS NULL)
  ),
  CONSTRAINT platform_email_delivery_result_shape CHECK (
    (last_result_code IS NULL AND last_result_summary IS NULL) OR
    (last_result_code IS NOT NULL AND last_result_summary IS NOT NULL)
  ),
  CONSTRAINT platform_email_delivery_timestamp_order CHECK (
    updated_at >= created_at AND
    (delivered_at IS NULL OR delivered_at >= created_at) AND
    (terminal_failed_at IS NULL OR terminal_failed_at >= created_at)
  )
);

CREATE INDEX IF NOT EXISTS platform_email_deliveries_recipient_idx
  ON platform_email_deliveries (
    recipient_account_id,
    recipient_role,
    delivery_sequence DESC
  );

CREATE INDEX IF NOT EXISTS platform_email_deliveries_company_scope_idx
  ON platform_email_deliveries (
    tenant_id,
    membership_id,
    recipient_account_id,
    delivery_sequence DESC
  )
  WHERE recipient_role = 'company';

CREATE INDEX IF NOT EXISTS platform_email_deliveries_status_idx
  ON platform_email_deliveries (status, delivery_sequence);

CREATE TABLE IF NOT EXISTS platform_email_delivery_attempts (
  attempt_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  email_attempt_id TEXT PRIMARY KEY CHECK (
    email_attempt_id ~ '^email_attempt_[A-Za-z0-9_-]{24}$'
  ),
  delivery_id TEXT NOT NULL
    REFERENCES platform_email_deliveries(delivery_id) ON DELETE RESTRICT,
  source_job_id TEXT NOT NULL
    REFERENCES platform_outbox_jobs(job_id) ON DELETE RESTRICT,
  source_outbox_attempt_id TEXT NOT NULL UNIQUE
    REFERENCES platform_outbox_job_attempts(attempt_id) ON DELETE RESTRICT,
  attempt_number SMALLINT NOT NULL CHECK (attempt_number BETWEEN 1 AND 5),
  worker_id TEXT NOT NULL CHECK (
    worker_id ~ '^outbox_worker_[A-Za-z0-9_-]{24}$'
  ),
  lease_id TEXT NOT NULL UNIQUE CHECK (
    lease_id ~ '^lease_[A-Za-z0-9_-]{24}$'
  ),
  adapter_key TEXT NOT NULL CHECK (adapter_key IN ('local_test')),
  dispatch_key TEXT NOT NULL UNIQUE CHECK (
    char_length(dispatch_key) = 64 AND dispatch_key ~ '^[a-f0-9]{64}$'
  ),
  outcome TEXT NOT NULL DEFAULT 'running' CHECK (
    outcome IN (
      'running',
      'delivered',
      'retryable_failure',
      'terminal_failure',
      'lease_expired'
    )
  ),
  result_code TEXT NULL CHECK (
    result_code IS NULL OR (
      char_length(result_code) BETWEEN 2 AND 120 AND
      result_code ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  result_summary TEXT NULL CHECK (
    result_summary IS NULL OR char_length(result_summary) BETWEEN 1 AND 240
  ),
  provider_reference_hash TEXT NULL CHECK (
    provider_reference_hash IS NULL OR (
      char_length(provider_reference_hash) = 64 AND
      provider_reference_hash ~ '^[a-f0-9]{64}$'
    )
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ NULL,
  CONSTRAINT platform_email_attempt_result_shape CHECK (
    (outcome = 'running' AND result_code IS NULL AND result_summary IS NULL AND provider_reference_hash IS NULL AND finished_at IS NULL) OR
    (outcome = 'delivered' AND result_code IS NOT NULL AND result_summary IS NOT NULL AND provider_reference_hash IS NOT NULL AND finished_at IS NOT NULL) OR
    (outcome IN ('retryable_failure', 'terminal_failure', 'lease_expired') AND result_code IS NOT NULL AND result_summary IS NOT NULL AND provider_reference_hash IS NULL AND finished_at IS NOT NULL)
  ),
  CONSTRAINT platform_email_attempt_timestamp_order CHECK (
    finished_at IS NULL OR finished_at >= started_at
  ),
  UNIQUE (delivery_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS platform_email_attempts_delivery_idx
  ON platform_email_delivery_attempts (delivery_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS platform_email_attempts_job_idx
  ON platform_email_delivery_attempts (source_job_id, attempt_number DESC);

CREATE OR REPLACE FUNCTION platform_email_delivery_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_job platform_outbox_jobs%ROWTYPE;
  eligible_recipient BOOLEAN;
BEGIN
  SELECT *
  INTO source_job
  FROM platform_outbox_jobs
  WHERE job_id = NEW.source_job_id;

  IF source_job.job_id IS NULL OR
     source_job.job_type <> 'email.delivery.foundation' OR
     source_job.schema_version <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Email delivery must originate from the registered email delivery outbox job.';
  END IF;

  IF source_job.enqueued_by_account_id IS DISTINCT FROM NEW.recipient_account_id OR
     source_job.enqueued_by_role IS DISTINCT FROM NEW.recipient_role OR
     source_job.tenant_id IS DISTINCT FROM NEW.tenant_id OR
     source_job.membership_id IS DISTINCT FROM NEW.membership_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Email delivery recipient scope must match its trusted source job.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth_accounts AS accounts
    JOIN auth_account_roles AS roles
      ON roles.account_id = accounts.account_id
     AND roles.role = NEW.recipient_role
    WHERE accounts.account_id = NEW.recipient_account_id
      AND accounts.account_status = 'active'
      AND accounts.email_verified_at IS NOT NULL
  ) INTO eligible_recipient;

  IF NOT eligible_recipient THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Email delivery recipient must be an active account with a verified email and assigned role.';
  END IF;

  IF NEW.recipient_role = 'company' AND NOT EXISTS (
    SELECT 1
    FROM auth_tenant_memberships AS memberships
    JOIN platform_tenants AS tenants
      ON tenants.tenant_id = memberships.tenant_id
    WHERE memberships.membership_id = NEW.membership_id
      AND memberships.tenant_id = NEW.tenant_id
      AND memberships.account_id = NEW.recipient_account_id
      AND memberships.portal_role = 'company'
      AND memberships.membership_status = 'active'
      AND tenants.tenant_status = 'active'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Company email delivery requires the active trusted tenant membership.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform_email_delivery_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.delivery_id IS DISTINCT FROM OLD.delivery_id OR
     NEW.delivery_sequence IS DISTINCT FROM OLD.delivery_sequence OR
     NEW.delivery_type IS DISTINCT FROM OLD.delivery_type OR
     NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
     NEW.source_job_id IS DISTINCT FROM OLD.source_job_id OR
     NEW.delivery_key IS DISTINCT FROM OLD.delivery_key OR
     NEW.recipient_account_id IS DISTINCT FROM OLD.recipient_account_id OR
     NEW.recipient_role IS DISTINCT FROM OLD.recipient_role OR
     NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.membership_id IS DISTINCT FROM OLD.membership_id OR
     NEW.recipient_address_hash IS DISTINCT FROM OLD.recipient_address_hash OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Email delivery identity and trusted scope are immutable.';
  END IF;

  IF NOT (
    (OLD.status = 'queued' AND NEW.status = 'processing') OR
    (OLD.status = 'retry_wait' AND NEW.status = 'processing') OR
    (OLD.status = 'processing' AND NEW.status IN ('retry_wait', 'delivered', 'terminal_failed'))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Email delivery state transition is invalid.';
  END IF;

  IF NEW.attempt_count < OLD.attempt_count OR
     NEW.attempt_count > OLD.attempt_count + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Email delivery attempt count transition is invalid.';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  IF NEW.status = 'delivered' THEN
    NEW.delivered_at := CURRENT_TIMESTAMP;
    NEW.terminal_failed_at := NULL;
  ELSIF NEW.status = 'terminal_failed' THEN
    NEW.delivered_at := NULL;
    NEW.terminal_failed_at := CURRENT_TIMESTAMP;
  ELSE
    NEW.delivered_at := NULL;
    NEW.terminal_failed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform_email_delivery_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Email delivery history cannot be deleted.';
END;
$$;

CREATE OR REPLACE FUNCTION platform_email_attempt_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_attempt platform_outbox_job_attempts%ROWTYPE;
  source_job platform_outbox_jobs%ROWTYPE;
  delivery platform_email_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO delivery
  FROM platform_email_deliveries
  WHERE delivery_id = NEW.delivery_id;

  SELECT * INTO source_attempt
  FROM platform_outbox_job_attempts
  WHERE attempt_id = NEW.source_outbox_attempt_id;

  SELECT * INTO source_job
  FROM platform_outbox_jobs
  WHERE job_id = NEW.source_job_id;

  IF delivery.delivery_id IS NULL OR
     delivery.source_job_id IS DISTINCT FROM NEW.source_job_id OR
     delivery.status NOT IN ('queued', 'retry_wait') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Email delivery attempt requires a queued or retrying delivery.';
  END IF;

  IF source_attempt.attempt_id IS NULL OR
     source_attempt.job_id IS DISTINCT FROM NEW.source_job_id OR
     source_attempt.attempt_number IS DISTINCT FROM NEW.attempt_number OR
     source_attempt.worker_id IS DISTINCT FROM NEW.worker_id OR
     source_attempt.lease_id IS DISTINCT FROM NEW.lease_id OR
     source_attempt.outcome <> 'running' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Email delivery attempt must bind to the active outbox attempt.';
  END IF;

  IF source_job.job_id IS NULL OR
     source_job.job_type <> 'email.delivery.foundation' OR
     source_job.status <> 'leased' OR
     source_job.lease_id IS DISTINCT FROM NEW.lease_id OR
     source_job.worker_id IS DISTINCT FROM NEW.worker_id OR
     source_job.lease_expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Email delivery attempt requires the currently owned unexpired outbox lease.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform_email_attempt_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email_attempt_id IS DISTINCT FROM OLD.email_attempt_id OR
     NEW.attempt_sequence IS DISTINCT FROM OLD.attempt_sequence OR
     NEW.delivery_id IS DISTINCT FROM OLD.delivery_id OR
     NEW.source_job_id IS DISTINCT FROM OLD.source_job_id OR
     NEW.source_outbox_attempt_id IS DISTINCT FROM OLD.source_outbox_attempt_id OR
     NEW.attempt_number IS DISTINCT FROM OLD.attempt_number OR
     NEW.worker_id IS DISTINCT FROM OLD.worker_id OR
     NEW.lease_id IS DISTINCT FROM OLD.lease_id OR
     NEW.adapter_key IS DISTINCT FROM OLD.adapter_key OR
     NEW.dispatch_key IS DISTINCT FROM OLD.dispatch_key OR
     NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Email delivery attempt identity and lease binding are immutable.';
  END IF;

  IF OLD.outcome <> 'running' OR
     NEW.outcome NOT IN ('delivered', 'retryable_failure', 'terminal_failure', 'lease_expired') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Email delivery attempt outcome is immutable after finalization.';
  END IF;

  NEW.finished_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform_email_attempt_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Email delivery attempt history cannot be deleted.';
END;
$$;

DROP TRIGGER IF EXISTS platform_email_deliveries_validate_insert
  ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_validate_insert
BEFORE INSERT ON platform_email_deliveries
FOR EACH ROW EXECUTE FUNCTION platform_email_delivery_validate_insert();

DROP TRIGGER IF EXISTS platform_email_deliveries_guard_update
  ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_guard_update
BEFORE UPDATE ON platform_email_deliveries
FOR EACH ROW EXECUTE FUNCTION platform_email_delivery_guard_update();

DROP TRIGGER IF EXISTS platform_email_deliveries_no_delete
  ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_no_delete
BEFORE DELETE ON platform_email_deliveries
FOR EACH ROW EXECUTE FUNCTION platform_email_delivery_reject_delete();

DROP TRIGGER IF EXISTS platform_email_attempts_validate_insert
  ON platform_email_delivery_attempts;
CREATE TRIGGER platform_email_attempts_validate_insert
BEFORE INSERT ON platform_email_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION platform_email_attempt_validate_insert();

DROP TRIGGER IF EXISTS platform_email_attempts_guard_update
  ON platform_email_delivery_attempts;
CREATE TRIGGER platform_email_attempts_guard_update
BEFORE UPDATE ON platform_email_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION platform_email_attempt_guard_update();

DROP TRIGGER IF EXISTS platform_email_attempts_no_delete
  ON platform_email_delivery_attempts;
CREATE TRIGGER platform_email_attempts_no_delete
BEFORE DELETE ON platform_email_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION platform_email_attempt_reject_delete();
