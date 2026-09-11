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
      'outbox.job.terminal_failed'
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
      'platform'
    )
  );

CREATE TABLE IF NOT EXISTS platform_outbox_jobs (
  job_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  job_id TEXT PRIMARY KEY CHECK (
    job_id LIKE 'job\_%' ESCAPE '\' AND
    char_length(job_id) BETWEEN 8 AND 160
  ),
  job_type TEXT NOT NULL CHECK (
    job_type IN ('platform.foundation.noop')
  ),
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  idempotency_key TEXT NOT NULL CHECK (
    char_length(idempotency_key) = 64 AND
    idempotency_key ~ '^[a-f0-9]{64}$'
  ),
  payload JSONB NOT NULL CHECK (
    jsonb_typeof(payload) = 'object' AND
    octet_length(payload::text) <= 8192
  ),
  enqueued_by_account_id TEXT NOT NULL,
  enqueued_by_role TEXT NOT NULL CHECK (
    enqueued_by_role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  tenant_id TEXT NULL,
  membership_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'leased', 'retry_wait', 'succeeded', 'terminal_failed')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    attempt_count BETWEEN 0 AND 5
  ),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts = 5),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_id TEXT NULL,
  worker_id TEXT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  succeeded_at TIMESTAMPTZ NULL,
  terminal_failed_at TIMESTAMPTZ NULL,
  last_error_code TEXT NULL CHECK (
    last_error_code IS NULL OR (
      char_length(last_error_code) BETWEEN 2 AND 120 AND
      last_error_code ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  last_error_summary TEXT NULL CHECK (
    last_error_summary IS NULL OR
    char_length(last_error_summary) BETWEEN 1 AND 240
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT platform_outbox_job_deduplication
    UNIQUE (job_type, idempotency_key),
  CONSTRAINT platform_outbox_tenant_membership_pair CHECK (
    (tenant_id IS NULL AND membership_id IS NULL) OR
    (tenant_id IS NOT NULL AND membership_id IS NOT NULL)
  ),
  CONSTRAINT platform_outbox_lease_triplet CHECK (
    (lease_id IS NULL AND worker_id IS NULL AND lease_expires_at IS NULL) OR
    (lease_id IS NOT NULL AND worker_id IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT platform_outbox_lifecycle_shape CHECK (
    (status = 'pending' AND attempt_count = 0 AND lease_id IS NULL
      AND succeeded_at IS NULL AND terminal_failed_at IS NULL) OR
    (status = 'leased' AND attempt_count >= 1 AND lease_id IS NOT NULL
      AND succeeded_at IS NULL AND terminal_failed_at IS NULL) OR
    (status = 'retry_wait' AND attempt_count >= 1 AND attempt_count < max_attempts
      AND lease_id IS NULL AND succeeded_at IS NULL AND terminal_failed_at IS NULL) OR
    (status = 'succeeded' AND attempt_count >= 1 AND lease_id IS NULL
      AND succeeded_at IS NOT NULL AND terminal_failed_at IS NULL) OR
    (status = 'terminal_failed' AND attempt_count >= 1 AND lease_id IS NULL
      AND succeeded_at IS NULL AND terminal_failed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS platform_outbox_jobs_available_idx
  ON platform_outbox_jobs (
    next_attempt_at,
    job_sequence
  )
  WHERE status IN ('pending', 'retry_wait');

CREATE INDEX IF NOT EXISTS platform_outbox_jobs_expired_lease_idx
  ON platform_outbox_jobs (
    lease_expires_at,
    job_sequence
  )
  WHERE status = 'leased';

CREATE INDEX IF NOT EXISTS platform_outbox_jobs_tenant_idx
  ON platform_outbox_jobs (
    tenant_id,
    job_sequence DESC
  )
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS platform_outbox_jobs_status_idx
  ON platform_outbox_jobs (
    status,
    job_sequence DESC
  );

CREATE TABLE IF NOT EXISTS platform_outbox_job_attempts (
  attempt_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  attempt_id TEXT PRIMARY KEY CHECK (
    attempt_id LIKE 'attempt\_%' ESCAPE '\' AND
    char_length(attempt_id) BETWEEN 12 AND 180
  ),
  job_id TEXT NOT NULL REFERENCES platform_outbox_jobs(job_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 5),
  worker_id TEXT NOT NULL CHECK (
    worker_id LIKE 'outbox\_worker\_%' ESCAPE '\' AND
    char_length(worker_id) BETWEEN 20 AND 180
  ),
  lease_id TEXT NOT NULL UNIQUE CHECK (
    lease_id LIKE 'lease\_%' ESCAPE '\' AND
    char_length(lease_id) BETWEEN 10 AND 180
  ),
  outcome TEXT NOT NULL CHECK (
    outcome IN (
      'running',
      'succeeded',
      'retry_scheduled',
      'terminal_failed',
      'lease_expired'
    )
  ),
  error_code TEXT NULL CHECK (
    error_code IS NULL OR (
      char_length(error_code) BETWEEN 2 AND 120 AND
      error_code ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  error_summary TEXT NULL CHECK (
    error_summary IS NULL OR
    char_length(error_summary) BETWEEN 1 AND 240
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ NULL,
  next_attempt_at TIMESTAMPTZ NULL,
  CONSTRAINT platform_outbox_attempt_number
    UNIQUE (job_id, attempt_number),
  CONSTRAINT platform_outbox_attempt_lifecycle CHECK (
    (outcome = 'running' AND finished_at IS NULL
      AND error_code IS NULL AND error_summary IS NULL
      AND next_attempt_at IS NULL) OR
    (outcome = 'succeeded' AND finished_at IS NOT NULL
      AND error_code IS NULL AND error_summary IS NULL
      AND next_attempt_at IS NULL) OR
    (outcome = 'retry_scheduled' AND finished_at IS NOT NULL
      AND error_code IS NOT NULL AND error_summary IS NOT NULL
      AND next_attempt_at IS NOT NULL) OR
    (outcome IN ('terminal_failed', 'lease_expired') AND finished_at IS NOT NULL
      AND error_code IS NOT NULL AND error_summary IS NOT NULL
      AND next_attempt_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS platform_outbox_attempts_job_idx
  ON platform_outbox_job_attempts (
    job_id,
    attempt_number DESC
  );

CREATE OR REPLACE FUNCTION platform_outbox_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform outbox history cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS platform_outbox_jobs_no_delete
  ON platform_outbox_jobs;
CREATE TRIGGER platform_outbox_jobs_no_delete
BEFORE DELETE ON platform_outbox_jobs
FOR EACH ROW
EXECUTE FUNCTION platform_outbox_reject_delete();

DROP TRIGGER IF EXISTS platform_outbox_attempts_no_delete
  ON platform_outbox_job_attempts;
CREATE TRIGGER platform_outbox_attempts_no_delete
BEFORE DELETE ON platform_outbox_job_attempts
FOR EACH ROW
EXECUTE FUNCTION platform_outbox_reject_delete();
