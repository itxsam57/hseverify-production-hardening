-- Additive concern binding and review. Never infer links for old hash-only intake.
CREATE TABLE public_verification_concern_subjects (
 concern_id text PRIMARY KEY REFERENCES public_verification_concerns(concern_id) ON DELETE RESTRICT,
 subject_kind text NOT NULL CHECK(subject_kind IN ('worker','credential')),
 subject_identifier text NOT NULL CHECK(length(subject_identifier) BETWEEN 8 AND 160),
 worker_reference text NOT NULL CHECK(length(worker_reference) BETWEEN 8 AND 160),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public_verification_concern_reviews (
 concern_id text NOT NULL REFERENCES public_verification_concerns(concern_id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version > 0),
 outcome text NOT NULL CHECK(outcome IN ('reviewed_no_further_action','follow_up_needed')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 4000 AND reason=btrim(reason)),
 methods text NOT NULL CHECK(length(btrim(methods)) BETWEEN 10 AND 2000 AND methods=btrim(methods)),
 limitations text NOT NULL CHECK(length(btrim(limitations)) BETWEEN 10 AND 2000 AND limitations=btrim(limitations)),
 actor_account_id text NOT NULL REFERENCES auth_accounts(account_id),
 actor_session_id text NOT NULL,
 request_id text NOT NULL CHECK(request_id ~ '^concern_review_[A-Za-z0-9_-]{24}$'),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(concern_id,version),
 UNIQUE(concern_id,request_id)
);
CREATE TRIGGER public_verification_concern_subjects_immutable BEFORE UPDATE OR DELETE ON public_verification_concern_subjects
 FOR EACH ROW EXECUTE FUNCTION hse_guard_public_verification_concern_history();
CREATE TRIGGER public_verification_concern_reviews_immutable BEFORE UPDATE OR DELETE ON public_verification_concern_reviews
 FOR EACH ROW EXECUTE FUNCTION hse_guard_public_verification_concern_history();
-- Preserve the complete installed action vocabulary without rebuilding older checks.
DO $$
DECLARE current_check text; installed_check text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO current_check FROM pg_constraint
 WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check';
 IF current_check IS NULL THEN RAISE EXCEPTION 'Audit action constraint missing'; END IF;
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 IF left(current_check,7) <> 'CHECK (' OR right(current_check,1) <> ')' THEN
  RAISE EXCEPTION 'Audit action constraint shape is unsupported';
 END IF;
 EXECUTE 'ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK (' ||
  substring(current_check from 8 for char_length(current_check)-8) ||
  ' OR action_key IN (''public_verification.concern.reviewed'',''public_verification.concern.evidence.served''))';
 SELECT pg_get_constraintdef(oid) INTO installed_check FROM pg_constraint
 WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check';
 EXECUTE format('CREATE FUNCTION hse_concern_review_rollback_checks() RETURNS jsonb LANGUAGE sql IMMUTABLE AS %L',
  'SELECT ' || quote_literal(jsonb_build_object('original',current_check,'installed',installed_check)::text) || '::jsonb');
END $$;
