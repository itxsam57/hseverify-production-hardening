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
      'notification.deep_link.denied'
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
      'platform'
    )
  );

ALTER TABLE platform_outbox_jobs
  DROP CONSTRAINT IF EXISTS platform_outbox_jobs_job_type_check;
ALTER TABLE platform_outbox_jobs
  ADD CONSTRAINT platform_outbox_jobs_job_type_check CHECK (
    job_type IN (
      'platform.foundation.noop',
      'notification.portal.foundation'
    )
  );

CREATE TABLE IF NOT EXISTS platform_notifications (
  notification_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  notification_id TEXT PRIMARY KEY CHECK (
    notification_id ~ '^notification_[A-Za-z0-9_-]{24}$'
  ),
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('platform.foundation.ready')
  ),
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  source_job_id TEXT NOT NULL UNIQUE
    REFERENCES platform_outbox_jobs(job_id) ON DELETE RESTRICT,
  projection_key TEXT NOT NULL UNIQUE CHECK (
    char_length(projection_key) = 64 AND
    projection_key ~ '^[a-f0-9]{64}$'
  ),
  recipient_account_id TEXT NOT NULL
    REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  recipient_role TEXT NOT NULL CHECK (
    recipient_role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  tenant_id TEXT NULL,
  membership_id TEXT NULL,
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 500),
  metadata JSONB NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object' AND
    octet_length(metadata::text) <= 2048
  ),
  target_key TEXT NOT NULL CHECK (target_key IN ('portal.dashboard')),
  target_reference TEXT NULL,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT platform_notification_tenant_scope_shape CHECK (
    (
      recipient_role = 'company' AND
      tenant_id IS NOT NULL AND membership_id IS NOT NULL
    ) OR (
      recipient_role <> 'company' AND
      tenant_id IS NULL AND membership_id IS NULL
    )
  ),
  CONSTRAINT platform_notification_dashboard_target_shape CHECK (
    target_key <> 'portal.dashboard' OR target_reference IS NULL
  ),
  CONSTRAINT platform_notification_timestamp_order CHECK (
    updated_at >= created_at AND
    (read_at IS NULL OR read_at >= created_at)
  )
);

CREATE INDEX IF NOT EXISTS platform_notifications_recipient_idx
  ON platform_notifications (
    recipient_account_id,
    recipient_role,
    notification_sequence DESC
  );

CREATE INDEX IF NOT EXISTS platform_notifications_company_scope_idx
  ON platform_notifications (
    tenant_id,
    membership_id,
    recipient_account_id,
    notification_sequence DESC
  )
  WHERE recipient_role = 'company';

CREATE INDEX IF NOT EXISTS platform_notifications_unread_idx
  ON platform_notifications (
    recipient_account_id,
    recipient_role,
    notification_sequence DESC
  )
  WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION platform_notification_validate_projection()
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

  IF NOT FOUND OR source_job.job_type <> 'notification.portal.foundation' THEN
    RAISE EXCEPTION 'notification must originate from a registered notification outbox job'
      USING ERRCODE = '23514';
  END IF;

  IF source_job.enqueued_by_account_id IS DISTINCT FROM NEW.recipient_account_id
     OR source_job.enqueued_by_role IS DISTINCT FROM NEW.recipient_role
     OR source_job.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR source_job.membership_id IS DISTINCT FROM NEW.membership_id THEN
    RAISE EXCEPTION 'notification recipient scope does not match its outbox job'
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth_accounts AS accounts
    JOIN auth_account_roles AS roles
      ON roles.account_id = accounts.account_id
     AND roles.role = NEW.recipient_role
    WHERE accounts.account_id = NEW.recipient_account_id
      AND accounts.account_status = 'active'
      AND (
        (
          NEW.recipient_role <> 'company'
          AND NEW.tenant_id IS NULL
          AND NEW.membership_id IS NULL
        ) OR (
          NEW.recipient_role = 'company'
          AND EXISTS (
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
          )
        )
      )
  ) INTO eligible_recipient;

  IF NOT eligible_recipient THEN
    RAISE EXCEPTION 'notification recipient is not eligible for the recorded portal scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.notification_type <> 'platform.foundation.ready'
     OR NEW.schema_version <> 1
     OR NEW.title <> 'Notification foundation ready'
     OR NEW.body <> 'This persisted notification verifies the current portal notification channel.'
     OR NEW.target_key <> 'portal.dashboard'
     OR NEW.target_reference IS NOT NULL
     OR NEW.metadata IS DISTINCT FROM source_job.payload
     OR jsonb_typeof(NEW.metadata) <> 'object'
     OR NOT (NEW.metadata ? 'fixtureRef')
     OR NEW.metadata - 'fixtureRef' <> '{}'::jsonb
     OR char_length(COALESCE(NEW.metadata->>'fixtureRef', '')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'notification content does not match its registered projection contract'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.read_at IS NOT NULL THEN
    RAISE EXCEPTION 'new notifications must begin unread'
      USING ERRCODE = '23514';
  END IF;

  NEW.created_at := CURRENT_TIMESTAMP;
  NEW.updated_at := NEW.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_notifications_validate_insert
  ON platform_notifications;
CREATE TRIGGER platform_notifications_validate_insert
BEFORE INSERT ON platform_notifications
FOR EACH ROW
EXECUTE FUNCTION platform_notification_validate_projection();

CREATE OR REPLACE FUNCTION platform_notification_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.notification_sequence IS DISTINCT FROM NEW.notification_sequence
     OR OLD.notification_id IS DISTINCT FROM NEW.notification_id
     OR OLD.notification_type IS DISTINCT FROM NEW.notification_type
     OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
     OR OLD.source_job_id IS DISTINCT FROM NEW.source_job_id
     OR OLD.projection_key IS DISTINCT FROM NEW.projection_key
     OR OLD.recipient_account_id IS DISTINCT FROM NEW.recipient_account_id
     OR OLD.recipient_role IS DISTINCT FROM NEW.recipient_role
     OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.membership_id IS DISTINCT FROM NEW.membership_id
     OR OLD.title IS DISTINCT FROM NEW.title
     OR OLD.body IS DISTINCT FROM NEW.body
     OR OLD.metadata IS DISTINCT FROM NEW.metadata
     OR OLD.target_key IS DISTINCT FROM NEW.target_key
     OR OLD.target_reference IS DISTINCT FROM NEW.target_reference
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'notification immutable fields cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.read_at IS NOT NULL OR NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'notification read state is one-way'
      USING ERRCODE = '55000';
  END IF;

  NEW.read_at := CURRENT_TIMESTAMP;
  NEW.updated_at := NEW.read_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_notifications_guard_update
  ON platform_notifications;
CREATE TRIGGER platform_notifications_guard_update
BEFORE UPDATE ON platform_notifications
FOR EACH ROW
EXECUTE FUNCTION platform_notification_guard_update();

CREATE OR REPLACE FUNCTION platform_notification_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'notification history cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS platform_notifications_no_delete
  ON platform_notifications;
CREATE TRIGGER platform_notifications_no_delete
BEFORE DELETE ON platform_notifications
FOR EACH ROW
EXECUTE FUNCTION platform_notification_reject_delete();
