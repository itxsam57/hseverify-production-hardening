ALTER TABLE interview_requests
 ADD COLUMN replaces_interview_request_id TEXT,
 ADD CONSTRAINT interview_replacement_scope UNIQUE(tenant_id,case_id,worker_account_id,interview_request_id),
 ADD CONSTRAINT interview_replacement_same_case FOREIGN KEY(tenant_id,case_id,worker_account_id,replaces_interview_request_id)
 REFERENCES interview_requests(tenant_id,case_id,worker_account_id,interview_request_id),
 ADD CONSTRAINT interview_single_replacement UNIQUE(replaces_interview_request_id),
 ADD CONSTRAINT interview_replacement_is_distinct CHECK(replaces_interview_request_id IS NULL OR replaces_interview_request_id<>interview_request_id);
DO $$
DECLARE original TEXT;BEGIN
 SELECT pg_get_constraintdef(oid) INTO original FROM pg_constraint
 WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check';
 IF original IS NULL THEN RAISE EXCEPTION 'Required audit constraint missing';END IF;
 EXECUTE format('CREATE FUNCTION platform_interview_replacement_original_check() RETURNS TEXT LANGUAGE sql IMMUTABLE AS %L',
 'SELECT '||quote_literal(original)||'::text');
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE format('ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK ((%s) OR action_key=''interview.replacement.requested'')',
 regexp_replace(original,'^CHECK \((.*)\)$','\1'));
END;$$;

DO $$
DECLARE original TEXT; BEGIN
 SELECT pg_get_constraintdef(oid) INTO original FROM pg_constraint
 WHERE conrelid='assurance_action_items'::regclass AND conname='assurance_action_items_deep_link_check';
 IF original IS NULL THEN RAISE EXCEPTION 'Required action destination constraint missing'; END IF;
 EXECUTE format('CREATE FUNCTION interview_replacement_original_destination_check() RETURNS TEXT LANGUAGE sql IMMUTABLE AS %L',
 'SELECT '||quote_literal(original)||'::text');
 ALTER TABLE assurance_action_items DROP CONSTRAINT assurance_action_items_deep_link_check;
 EXECUTE format('ALTER TABLE assurance_action_items ADD CONSTRAINT assurance_action_items_deep_link_check CHECK ((%s) OR deep_link ~ ''^/assessor/interviews/interview_request_[A-Za-z0-9_-]{24}$'' OR deep_link = ''/admin/assessor-matching'')',
 regexp_replace(original,'^CHECK \((.*)\)$','\1'));
END; $$;
