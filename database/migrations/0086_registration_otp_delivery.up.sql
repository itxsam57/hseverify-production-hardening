
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
ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_enqueue_origin;
ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_enqueue_origin CHECK (
  (enqueued_by_account_id IS NOT NULL AND enqueued_by_role IS NOT NULL AND enqueued_system_component IS NULL) OR
  (enqueued_by_account_id IS NULL AND enqueued_by_role IS NULL AND
   ((enqueued_system_component='outbox-worker' AND job_type='assessment.attempt.expiry') OR
    (enqueued_system_component='registration-verification' AND job_type='authentication.challenge.delivery')) AND
   enqueued_system_component IS NOT NULL AND tenant_id IS NULL AND membership_id IS NULL)
);

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
