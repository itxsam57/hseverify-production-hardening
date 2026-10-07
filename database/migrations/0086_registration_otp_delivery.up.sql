
-- Provider history survives account abandonment and monotonic rollback/reapply.
CREATE TABLE IF NOT EXISTS auth_registration_delivery_intents (
  delivery_id TEXT PRIMARY KEY,
  challenge_id TEXT UNIQUE REFERENCES auth_otp_challenges(challenge_id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','dispatching','accepted','terminal','unknown','obsolete')),
  payload_ciphertext TEXT,
  dispatch_lease_id TEXT,
  provider_reference TEXT,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT registration_delivery_payload_state CHECK (
    (status IN ('queued','dispatching') AND payload_ciphertext IS NOT NULL) OR
    (status IN ('accepted','terminal','unknown','obsolete') AND payload_ciphertext IS NULL)
  )
);
-- Reapply may encounter retained historical challenge IDs after lower-layer rollback.
-- NOT VALID retains those IDs while enforcing every new/changed reference.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='auth_registration_delivery_intents'::regclass
      AND conname='auth_registration_delivery_intents_challenge_id_fkey') THEN
    ALTER TABLE auth_registration_delivery_intents
      ADD CONSTRAINT auth_registration_delivery_intents_challenge_id_fkey
      FOREIGN KEY(challenge_id) REFERENCES auth_otp_challenges(challenge_id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END;
$$;
DO $$
DECLARE old_check TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
    WHERE conrelid='platform_outbox_jobs'::regclass AND conname='platform_outbox_jobs_job_type_check';
  IF old_check IS NULL THEN RAISE EXCEPTION 'Required outbox constraint is missing'; END IF;
  old_check := regexp_replace(old_check, '^CHECK \((.*)\)$', '\1');
  ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_jobs_job_type_check;
  EXECUTE format('ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_jobs_job_type_check CHECK ((%s) OR job_type=%L)',
    old_check,'authentication.challenge.delivery');
END;
$$;
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
    old_origin,'registration-verification','authentication.challenge.delivery');
END;
$$;

-- Abandoned pending accounts must not leave encrypted destinations/codes behind.
CREATE OR REPLACE FUNCTION obsolete_registration_delivery_on_challenge_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE auth_registration_delivery_intents
    SET status='obsolete',payload_ciphertext=NULL,failure_code=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE challenge_id=OLD.challenge_id AND status IN ('queued','dispatching');
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS registration_delivery_challenge_delete ON auth_otp_challenges;
CREATE TRIGGER registration_delivery_challenge_delete BEFORE DELETE ON auth_otp_challenges
  FOR EACH ROW EXECUTE FUNCTION obsolete_registration_delivery_on_challenge_delete();
