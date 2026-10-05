-- Preserve every existing action while permitting native staff revocation audit.
DO $$
DECLARE previous_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO previous_definition FROM pg_constraint
  WHERE conrelid = 'platform_audit_events'::regclass AND conname = 'platform_audit_events_action_key_check';
  IF previous_definition IS NULL THEN RAISE EXCEPTION 'Missing platform audit action constraint'; END IF;
  ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
  EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK ((' ||
    substring(previous_definition FROM 7) || ') OR action_key = ''authentication.invitation.revoked'')';
END;
$$;
