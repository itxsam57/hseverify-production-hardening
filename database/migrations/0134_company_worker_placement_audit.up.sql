-- Extend the immutable Company workforce action vocabulary for active placement moves.
-- Preserve the exact prior audit CHECK definition for safe reversible rollback.
DO $$
DECLARE previous_definition TEXT;
DECLARE previous_expression TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO previous_definition
    FROM pg_constraint
   WHERE conrelid='platform_audit_events'::regclass
     AND conname='platform_audit_events_action_key_check';
  IF previous_definition IS NULL THEN
    RAISE EXCEPTION 'Required platform audit action constraint missing';
  END IF;
  IF position('company_workforce.link.placement_updated' IN previous_definition)>0 THEN
    RAISE EXCEPTION 'Placement audit action unexpectedly present before migration';
  END IF;
  previous_expression := regexp_replace(previous_definition,'^CHECK \((.*)\)$','\1');
  IF previous_expression=previous_definition THEN
    RAISE EXCEPTION 'Cannot safely parse previous platform audit CHECK definition';
  END IF;
  EXECUTE format(
    'CREATE FUNCTION hse_placement_old_audit_check() RETURNS TEXT LANGUAGE sql IMMUTABLE AS %L',
    'SELECT '||quote_literal(previous_definition)||'::text'
  );
  ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
  EXECUTE format(
    'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK ((%s) OR action_key=%L)',
    previous_expression,'company_workforce.link.placement_updated'
  );
END $$;
