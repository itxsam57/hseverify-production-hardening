-- Serialize rollback against new review/binding/audit writes before checking history.
LOCK TABLE public_verification_concern_subjects,public_verification_concern_reviews,platform_audit_events IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE saved jsonb; current_check text;
BEGIN
 IF EXISTS(SELECT 1 FROM public_verification_concern_subjects) OR EXISTS(SELECT 1 FROM public_verification_concern_reviews)
 OR EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key IN ('public_verification.concern.reviewed','public_verification.concern.evidence.served')) THEN
 RAISE EXCEPTION 'Credential concern binding and review history must be retained.' USING ERRCODE='55000';
 END IF;
 saved := hse_concern_review_rollback_checks();
 SELECT pg_get_constraintdef(oid) INTO current_check FROM pg_constraint
 WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check';
 IF current_check IS DISTINCT FROM saved->>'installed' THEN
  RAISE EXCEPTION 'Later audit vocabulary changes must be rolled back before credential concern review.' USING ERRCODE='55000';
 END IF;
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check ' || (saved->>'original');
END $$;
DROP TABLE public_verification_concern_reviews;
DROP TABLE public_verification_concern_subjects;
DROP FUNCTION hse_concern_review_rollback_checks();
