-- Do not erase an immutable Worker placement audit event to roll back.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform_audit_events
     WHERE action_key='company_workforce.link.placement_updated'
  ) THEN
    RAISE EXCEPTION 'Retained Worker placement history prevents audit vocabulary rollback'
      USING ERRCODE='55000';
  END IF;
  ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
  EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check '
    || hse_placement_old_audit_check();
END $$;
DROP FUNCTION hse_placement_old_audit_check();
