-- Required security notification intent is committed with the immutable source event.
DO $$
DECLARE
  item RECORD;
  old_check TEXT;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('platform_outbox_jobs', 'platform_outbox_jobs_job_type_check', 'job_type', '''notification.account.security'''),
    ('platform_notifications', 'platform_notifications_notification_type_check', 'notification_type', '''account.password.changed'', ''account.password.reset'', ''account.mfa.replaced'', ''account.recovery_codes.rotated'''),
    ('platform_notifications', 'platform_notifications_target_key_check', 'target_key', '''account.security''')
  ) AS extensions(table_name, constraint_name, column_name, values_sql)
  LOOP
    SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
      WHERE conrelid = item.table_name::regclass AND conname = item.constraint_name;
    IF old_check IS NULL THEN RAISE EXCEPTION 'Required notification constraint is missing'; END IF;
    old_check := regexp_replace(old_check, '^CHECK \((.*)\)$', '\1');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', item.table_name, item.constraint_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',
      item.table_name, item.constraint_name, old_check, item.column_name, item.values_sql);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION platform_account_security_notification_type(event_type_input TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE event_type_input
    WHEN 'password_changed' THEN 'account.password.changed'
    WHEN 'password_reset_completed' THEN 'account.password.reset'
    WHEN 'mfa_replaced' THEN 'account.mfa.replaced'
    WHEN 'mfa_recovery_codes_rotated' THEN 'account.recovery_codes.rotated'
  END
$$;

CREATE OR REPLACE FUNCTION platform_account_security_notification_title(type_input TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE type_input
    WHEN 'account.password.changed' THEN 'Password changed'
    WHEN 'account.password.reset' THEN 'Password reset'
    WHEN 'account.mfa.replaced' THEN 'Authenticator replaced'
    WHEN 'account.recovery_codes.rotated' THEN 'Recovery codes replaced'
  END
$$;

CREATE OR REPLACE FUNCTION platform_account_security_notification_body(type_input TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE type_input
    WHEN 'account.password.changed' THEN 'Your password was changed and other active sessions were revoked. Review your account security if you did not make this change.'
    WHEN 'account.password.reset' THEN 'Your password was reset and all previous sessions were revoked. Review your account security if you did not make this change.'
    WHEN 'account.mfa.replaced' THEN 'Your authenticator was replaced. Review your account security if you did not make this change.'
    WHEN 'account.recovery_codes.rotated' THEN 'A new recovery-code set replaced your previous codes. Review your account security if you did not make this change.'
  END
$$;

CREATE OR REPLACE FUNCTION platform_queue_account_security_notification()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  recipient RECORD;
  queued_job TEXT;
  scope_ref TEXT;
  dedup_key TEXT;
BEGIN
  IF platform_account_security_notification_type(NEW.event_type) IS NULL
     OR NEW.account_id IS NULL OR NEW.active_role IS NULL THEN RETURN NEW; END IF;

  FOR recipient IN
    SELECT NULL::TEXT AS tenant_id, NULL::TEXT AS membership_id
    FROM auth_accounts accounts JOIN auth_account_roles roles ON roles.account_id=accounts.account_id
    WHERE accounts.account_id=NEW.account_id AND roles.role=NEW.active_role
      AND accounts.account_status='active' AND NEW.active_role <> 'company'
    UNION ALL
    SELECT memberships.tenant_id, memberships.membership_id
    FROM auth_accounts accounts
    JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='company'
    JOIN auth_tenant_memberships memberships ON memberships.account_id=accounts.account_id
    JOIN platform_tenants tenants ON tenants.tenant_id=memberships.tenant_id
    WHERE accounts.account_id=NEW.account_id AND accounts.account_status='active'
      AND NEW.active_role='company' AND memberships.portal_role='company'
      AND memberships.membership_status='active' AND tenants.tenant_status IN ('pending','active')
  LOOP
    scope_ref := NEW.account_id || ':' || NEW.active_role || ':' || COALESCE(recipient.membership_id,'platform');
    dedup_key := encode(sha256(convert_to('notification.account.security:' || NEW.event_id || ':' || scope_ref,'UTF8')),'hex');
    INSERT INTO platform_outbox_jobs (
      job_id, job_type, schema_version, idempotency_key, payload,
      enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
    ) VALUES (
      'job_' || substr(dedup_key,1,24), 'notification.account.security', 1, dedup_key,
      jsonb_build_object('eventRef',NEW.event_id), NEW.account_id, NEW.active_role,
      recipient.tenant_id, recipient.membership_id
    ) ON CONFLICT (job_type,idempotency_key) DO NOTHING RETURNING job_id INTO queued_job;

    IF queued_job IS NOT NULL THEN
      INSERT INTO platform_audit_events (
        audit_event_id, source_kind, actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
        action_key, outcome, target_type, target_reference, metadata
      ) VALUES (
        'audit_' || queued_job, 'native', NEW.account_id, NEW.active_role, recipient.tenant_id, recipient.membership_id,
        'outbox.job.enqueued', 'succeeded', 'job', queued_job,
        jsonb_build_object('jobType','notification.account.security','sourceEventId',NEW.event_id)
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_security_events_notification_queue ON auth_security_events;
CREATE TRIGGER auth_security_events_notification_queue
AFTER INSERT ON auth_security_events
FOR EACH ROW EXECUTE FUNCTION platform_queue_account_security_notification();

CREATE OR REPLACE FUNCTION platform_notification_validate_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_job platform_outbox_jobs%ROWTYPE;
  eligible_recipient BOOLEAN;
  source_event auth_security_events%ROWTYPE;
  security_type TEXT;
BEGIN
  SELECT *
  INTO source_job
  FROM platform_outbox_jobs
  WHERE job_id = NEW.source_job_id;

  IF NOT FOUND OR source_job.job_type NOT IN ('notification.portal.foundation','notification.account.security') THEN
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
              AND (tenants.tenant_status = 'active' OR
                (source_job.job_type='notification.account.security' AND tenants.tenant_status='pending'))
          )
        )
      )
  ) INTO eligible_recipient;

  IF NOT eligible_recipient THEN
    RAISE EXCEPTION 'notification recipient is not eligible for the recorded portal scope'
      USING ERRCODE = '23514';
  END IF;

  IF source_job.job_type = 'notification.account.security' THEN
    SELECT * INTO source_event FROM auth_security_events
    WHERE event_id=source_job.payload->>'eventRef'
      AND account_id=NEW.recipient_account_id AND active_role=NEW.recipient_role;
    security_type := platform_account_security_notification_type(source_event.event_type);
    IF NOT FOUND OR security_type IS NULL
       OR NEW.notification_type IS DISTINCT FROM security_type
       OR NEW.schema_version <> 1
       OR NEW.title IS DISTINCT FROM platform_account_security_notification_title(security_type)
       OR NEW.body IS DISTINCT FROM platform_account_security_notification_body(security_type)
       OR NEW.target_key <> 'account.security' OR NEW.target_reference IS NOT NULL
       OR NEW.metadata IS DISTINCT FROM source_job.payload
       OR jsonb_typeof(NEW.metadata) <> 'object'
       OR NOT (NEW.metadata ? 'eventRef') OR NEW.metadata - 'eventRef' <> '{}'::jsonb
       OR char_length(COALESCE(NEW.metadata->>'eventRef','')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'security notification does not match its source event' USING ERRCODE='23514';
    END IF;
  ELSE
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

