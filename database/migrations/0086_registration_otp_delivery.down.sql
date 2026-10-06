-- Maintenance rollback: pause producers/workers before changing the schema.
-- Retain provider/audit history and vocabulary while releasing lower-layer ownership.
LOCK TABLE platform_outbox_jobs IN ACCESS EXCLUSIVE MODE;
LOCK TABLE auth_registration_delivery_intents IN ACCESS EXCLUSIVE MODE;
UPDATE auth_registration_delivery_intents
  SET status=CASE WHEN status='dispatching' THEN 'unknown' ELSE 'obsolete' END,
      payload_ciphertext=NULL,dispatch_lease_id=NULL,failure_code=NULL,updated_at=clock_timestamp()
  WHERE status IN ('queued','dispatching');
ALTER TABLE auth_registration_delivery_intents
  DROP CONSTRAINT IF EXISTS auth_registration_delivery_intents_challenge_id_fkey;
