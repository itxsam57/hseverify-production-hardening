CREATE TABLE IF NOT EXISTS platform_audit_events (
  audit_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  audit_event_id TEXT PRIMARY KEY CHECK (
    audit_event_id LIKE 'audit\_%' ESCAPE '\' AND
    char_length(audit_event_id) BETWEEN 8 AND 160
  ),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('native', 'auth_security_event')
  ),
  source_event_id TEXT NULL,
  actor_account_id TEXT NULL,
  actor_role TEXT NULL CHECK (
    actor_role IS NULL OR
    actor_role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  actor_tenant_id TEXT NULL,
  actor_membership_id TEXT NULL,
  action_key TEXT NOT NULL CHECK (
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
      'authorization.access.denied'
    )
  ),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('succeeded', 'denied', 'failed')
  ),
  reason_key TEXT NULL CHECK (
    reason_key IS NULL OR (
      char_length(reason_key) BETWEEN 2 AND 120 AND
      reason_key ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  target_type TEXT NOT NULL CHECK (
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
      'platform'
    )
  ),
  target_reference TEXT NULL CHECK (
    target_reference IS NULL OR char_length(target_reference) BETWEEN 1 AND 240
  ),
  request_fingerprint_hash TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object' AND
    octet_length(metadata::text) <= 16384
  ),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT platform_audit_source_identity
    UNIQUE (source_kind, source_event_id),
  CONSTRAINT platform_audit_tenant_membership_pair CHECK (
    (actor_tenant_id IS NULL AND actor_membership_id IS NULL) OR
    (actor_tenant_id IS NOT NULL AND actor_membership_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS platform_audit_events_time_idx
  ON platform_audit_events (occurred_at DESC, audit_sequence DESC);
CREATE INDEX IF NOT EXISTS platform_audit_events_actor_idx
  ON platform_audit_events (actor_account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_events_tenant_idx
  ON platform_audit_events (
    actor_tenant_id,
    occurred_at DESC,
    audit_sequence DESC
  )
  WHERE actor_tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_audit_events_action_idx
  ON platform_audit_events (action_key, outcome, occurred_at DESC);

CREATE OR REPLACE FUNCTION platform_audit_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform audit events are append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS platform_audit_events_append_only
  ON platform_audit_events;
CREATE TRIGGER platform_audit_events_append_only
BEFORE UPDATE OR DELETE ON platform_audit_events
FOR EACH ROW
EXECUTE FUNCTION platform_audit_reject_mutation();

CREATE OR REPLACE FUNCTION platform_audit_auth_action(event_type_input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE event_type_input
    WHEN 'registration_started' THEN 'authentication.registration.started'
    WHEN 'otp_issued' THEN 'authentication.otp.issued'
    WHEN 'otp_failed' THEN 'authentication.otp.failed'
    WHEN 'otp_verified' THEN 'authentication.otp.verified'
    WHEN 'password_created' THEN 'authentication.password.created'
    WHEN 'password_reset_requested' THEN 'authentication.password_reset.requested'
    WHEN 'password_reset_completed' THEN 'authentication.password_reset.completed'
    WHEN 'login_failed' THEN 'authentication.login.failed'
    WHEN 'login_succeeded' THEN 'authentication.login.succeeded'
    WHEN 'logout' THEN 'authentication.logout'
    WHEN 'session_revoked' THEN 'authentication.session.revoked'
    WHEN 'account_locked' THEN 'authentication.account.locked'
    WHEN 'account_unlocked' THEN 'authentication.account.unlocked'
    WHEN 'invitation_created' THEN 'authentication.invitation.created'
    WHEN 'invitation_accepted' THEN 'authentication.invitation.accepted'
    WHEN 'mfa_enrolled' THEN 'authentication.mfa.enrolled'
    WHEN 'mfa_failed' THEN 'authentication.mfa.failed'
    WHEN 'mfa_succeeded' THEN 'authentication.mfa.succeeded'
    WHEN 'access_denied' THEN 'authorization.access.denied'
  END
$$;

CREATE OR REPLACE FUNCTION platform_audit_auth_outcome(event_type_input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN event_type_input = 'access_denied' THEN 'denied'
    WHEN event_type_input IN ('otp_failed', 'login_failed', 'mfa_failed')
      THEN 'failed'
    ELSE 'succeeded'
  END
$$;

CREATE OR REPLACE FUNCTION platform_audit_auth_target_type(event_type_input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN event_type_input IN ('logout', 'session_revoked')
      THEN 'session'
    WHEN event_type_input IN ('invitation_created', 'invitation_accepted')
      THEN 'invitation'
    WHEN event_type_input IN ('mfa_enrolled', 'mfa_failed', 'mfa_succeeded')
      THEN 'mfa_factor'
    WHEN event_type_input = 'access_denied'
      THEN 'portal'
    WHEN event_type_input IN (
      'registration_started',
      'password_created',
      'password_reset_requested',
      'password_reset_completed',
      'account_locked',
      'account_unlocked'
    ) THEN 'account'
    ELSE 'authentication'
  END
$$;

CREATE OR REPLACE FUNCTION platform_audit_safe_reason(metadata_input JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(metadata_input -> 'reason') = 'string'
     AND lower(metadata_input ->> 'reason') ~ '^[a-z0-9][a-z0-9._-]{1,119}$'
      THEN lower(metadata_input ->> 'reason')
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION platform_audit_safe_metadata(metadata_input JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  input_type TEXT;
  safe_result JSONB;
  entry RECORD;
BEGIN
  IF metadata_input IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  input_type := jsonb_typeof(metadata_input);
  IF input_type = 'object' THEN
    safe_result := '{}'::jsonb;
    FOR entry IN
      SELECT key, value
      FROM jsonb_each(metadata_input)
      ORDER BY key
    LOOP
      IF lower(entry.key) !~
        '(password|passcode|otp|token|secret|cookie|authorization|csrf|credential)'
      THEN
        safe_result := safe_result || jsonb_build_object(
          entry.key,
          platform_audit_safe_metadata(entry.value)
        );
      END IF;
    END LOOP;
    RETURN safe_result;
  END IF;

  IF input_type = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        platform_audit_safe_metadata(items.value)
        ORDER BY items.ordinality
      ),
      '[]'::jsonb
    )
      INTO safe_result
    FROM jsonb_array_elements(metadata_input)
      WITH ORDINALITY AS items(value, ordinality);
    RETURN safe_result;
  END IF;

  RETURN metadata_input;
END;
$$;

CREATE OR REPLACE FUNCTION platform_audit_mirror_auth_security_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trusted_tenant_id TEXT := NULL;
  trusted_membership_id TEXT := NULL;
  target_reference_value TEXT := NULL;
BEGIN
  IF NEW.active_role = 'company' AND NEW.account_id IS NOT NULL THEN
    SELECT memberships.tenant_id, memberships.membership_id
      INTO trusted_tenant_id, trusted_membership_id
    FROM auth_tenant_memberships AS memberships
    WHERE memberships.account_id = NEW.account_id
      AND memberships.portal_role = 'company'
    ORDER BY
      CASE memberships.membership_status
        WHEN 'active' THEN 0
        WHEN 'suspended' THEN 1
        WHEN 'invited' THEN 2
        ELSE 3
      END,
      memberships.created_at DESC,
      memberships.membership_id
    LIMIT 1;
  END IF;

  target_reference_value := COALESCE(
    NULLIF(NEW.metadata ->> 'sessionId', ''),
    NULLIF(NEW.metadata ->> 'invitationId', ''),
    NULLIF(NEW.metadata ->> 'challengeId', ''),
    NEW.account_id
  );

  INSERT INTO platform_audit_events (
    audit_event_id,
    source_kind,
    source_event_id,
    actor_account_id,
    actor_role,
    actor_tenant_id,
    actor_membership_id,
    action_key,
    outcome,
    reason_key,
    target_type,
    target_reference,
    request_fingerprint_hash,
    metadata,
    occurred_at,
    recorded_at
  ) VALUES (
    'audit_' || NEW.event_id,
    'auth_security_event',
    NEW.event_id,
    NEW.account_id,
    NEW.active_role,
    trusted_tenant_id,
    trusted_membership_id,
    platform_audit_auth_action(NEW.event_type),
    platform_audit_auth_outcome(NEW.event_type),
    platform_audit_safe_reason(NEW.metadata),
    platform_audit_auth_target_type(NEW.event_type),
    target_reference_value,
    NEW.request_fingerprint_hash,
    platform_audit_safe_metadata(NEW.metadata),
    NEW.occurred_at,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (source_kind, source_event_id) DO NOTHING;

  RETURN NEW;
END;
$$;

INSERT INTO platform_audit_events (
  audit_event_id,
  source_kind,
  source_event_id,
  actor_account_id,
  actor_role,
  actor_tenant_id,
  actor_membership_id,
  action_key,
  outcome,
  reason_key,
  target_type,
  target_reference,
  request_fingerprint_hash,
  metadata,
  occurred_at,
  recorded_at
)
SELECT
  'audit_' || events.event_id,
  'auth_security_event',
  events.event_id,
  events.account_id,
  events.active_role,
  NULL,
  NULL,
  platform_audit_auth_action(events.event_type),
  platform_audit_auth_outcome(events.event_type),
  platform_audit_safe_reason(events.metadata),
  platform_audit_auth_target_type(events.event_type),
  COALESCE(
    NULLIF(events.metadata ->> 'sessionId', ''),
    NULLIF(events.metadata ->> 'invitationId', ''),
    NULLIF(events.metadata ->> 'challengeId', ''),
    events.account_id
  ),
  events.request_fingerprint_hash,
  platform_audit_safe_metadata(events.metadata),
  events.occurred_at,
  CURRENT_TIMESTAMP
FROM auth_security_events AS events
ON CONFLICT (source_kind, source_event_id) DO NOTHING;

DROP TRIGGER IF EXISTS auth_security_events_platform_audit_mirror
  ON auth_security_events;
CREATE TRIGGER auth_security_events_platform_audit_mirror
AFTER INSERT ON auth_security_events
FOR EACH ROW
EXECUTE FUNCTION platform_audit_mirror_auth_security_event();
