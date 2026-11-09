DO $$ DECLARE original TEXT; BEGIN
 SELECT pg_get_constraintdef(oid) INTO original FROM pg_constraint WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check';
 IF original IS NULL THEN RAISE EXCEPTION 'Required audit constraint missing'; END IF;
 EXECUTE format('CREATE FUNCTION hse_review_calibration_original_audit_check() RETURNS TEXT LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(original)||'::text');
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK ((' || substring(original FROM 7) || ') OR action_key IN (''evidence_review.framework.bound'',''staff.calibration.recorded'',''framework.revision.recorded''))';
END; $$;
