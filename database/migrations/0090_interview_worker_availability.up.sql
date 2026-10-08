ALTER TABLE interview_requests
 ADD COLUMN candidate_available_from TIMESTAMPTZ,
 ADD COLUMN candidate_available_until TIMESTAMPTZ,
 ADD CONSTRAINT interview_candidate_availability_window CHECK (
 (candidate_available_from IS NULL AND candidate_available_until IS NULL) OR
 (candidate_available_from IS NOT NULL AND candidate_available_until IS NOT NULL AND candidate_available_from<candidate_available_until));
DO $$
DECLARE original TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO original FROM pg_constraint
 WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check';
 IF original IS NULL THEN RAISE EXCEPTION 'Required audit constraint missing';END IF;
 EXECUTE format('CREATE FUNCTION platform_interview_availability_original_check() RETURNS TEXT LANGUAGE sql IMMUTABLE AS %L',
 'SELECT '||quote_literal(original)||'::text');
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE format('ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK ((%s) OR action_key=''interview.availability.updated'')',
 regexp_replace(original,'^CHECK \((.*)\)$','\1'));
END;$$;
