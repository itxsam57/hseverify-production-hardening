-- Preserve encrypted intent/provider history; extend only the fixed purpose-bound origin.
-- Add only this fixed component/job pair; preserve higher-layer history on reapply.
DO $$
DECLARE old_origin TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO old_origin FROM pg_constraint
    WHERE conrelid='platform_outbox_jobs'::regclass AND conname='platform_outbox_enqueue_origin';
  IF old_origin IS NULL THEN RAISE EXCEPTION 'Required outbox origin constraint is missing'; END IF;
  old_origin := regexp_replace(old_origin, '^CHECK \((.*)\)$', '\1');
  ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_enqueue_origin;
  EXECUTE format('ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_enqueue_origin CHECK ((%s) OR (enqueued_by_account_id IS NULL AND enqueued_by_role IS NULL AND enqueued_system_component IS NOT NULL AND enqueued_system_component=%L AND job_type=%L AND tenant_id IS NULL AND membership_id IS NULL))',
    old_origin,'recovery-verification','authentication.challenge.delivery');
END;
$$;
