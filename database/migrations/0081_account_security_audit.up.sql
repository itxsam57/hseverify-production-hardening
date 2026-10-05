-- Preserve every existing action while permitting native account-security audit.
DO $$
DECLARE previous_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO previous_definition FROM pg_constraint
  WHERE conrelid = 'platform_audit_events'::regclass AND conname = 'platform_audit_events_action_key_check';
  IF previous_definition IS NULL THEN RAISE EXCEPTION 'Missing platform audit action constraint'; END IF;
  ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
  EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK ((' ||
    substring(previous_definition FROM 7) || ') OR action_key IN (''authentication.password.changed'', ''authentication.mfa.replaced'', ''authentication.mfa.recovery_codes.rotated''))';
END;
$$;

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
    WHEN 'password_changed' THEN 'authentication.password.changed'
    WHEN 'mfa_replaced' THEN 'authentication.mfa.replaced'
    WHEN 'mfa_recovery_codes_rotated' THEN 'authentication.mfa.recovery_codes.rotated'
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
      'password_changed',
      'mfa_replaced',
      'mfa_recovery_codes_rotated',
      'password_reset_requested',
      'password_reset_completed',
      'account_locked',
      'account_unlocked'
    ) THEN 'account'
    ELSE 'authentication'
  END
$$;
