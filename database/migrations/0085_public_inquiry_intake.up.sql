CREATE TABLE IF NOT EXISTS public_inquiries (
 inquiry_id TEXT PRIMARY KEY, submission_key TEXT NOT NULL UNIQUE,
 fingerprint_hash TEXT NOT NULL CHECK(fingerprint_hash ~ '^[a-f0-9]{64}$'),
 kind TEXT NOT NULL CHECK(kind IN ('contact','demo')),
 contact_name TEXT NOT NULL, email TEXT NOT NULL, company TEXT NOT NULL,
 message TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS public_inquiries_received_idx ON public_inquiries(received_at DESC,inquiry_id);
CREATE TABLE IF NOT EXISTS public_inquiry_rate_windows(
 bucket_key TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL,
 used INTEGER NOT NULL CHECK(used>0),
 PRIMARY KEY(bucket_key,window_start)
);
CREATE INDEX IF NOT EXISTS public_inquiry_rate_window_age_idx ON public_inquiry_rate_windows(window_start);
DO $$
DECLARE old_check TEXT;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
 WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check';
 IF old_check IS NULL THEN RAISE EXCEPTION 'Required audit action constraint is missing'; END IF;
 IF position('public_inquiry.received' IN old_check)=0 THEN
  old_check := regexp_replace(old_check, '^CHECK \((.*)\)$', '\1');
  ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
  EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK (('
    || old_check || ') OR action_key=''public_inquiry.received'')';
 END IF;
END; $$;
