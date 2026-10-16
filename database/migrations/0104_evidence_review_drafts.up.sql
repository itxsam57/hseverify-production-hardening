CREATE TABLE evidence_review_draft_revisions (
 task_id text NOT NULL REFERENCES evidence_review_tasks(task_id),
 verifier_account_id text NOT NULL REFERENCES auth_accounts(account_id),
 revision integer NOT NULL CHECK(revision>0),
 notes text NOT NULL CHECK(length(notes) BETWEEN 5 AND 4000),
 saved_at timestamptz NOT NULL,
 PRIMARY KEY(task_id,verifier_account_id,revision)
);
CREATE FUNCTION hse_review_draft_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Reviewer draft history is append-only and immutable.' USING ERRCODE='55000'; END $$;
CREATE TRIGGER evidence_review_drafts_append_only BEFORE UPDATE OR DELETE ON evidence_review_draft_revisions FOR EACH ROW EXECUTE FUNCTION hse_review_draft_immutable();
DO $$ DECLARE original TEXT; BEGIN
 SELECT pg_get_constraintdef(oid) INTO original FROM pg_constraint WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check';
 IF original IS NULL THEN RAISE EXCEPTION 'Audit action constraint missing'; END IF;
 EXECUTE format('CREATE FUNCTION hse_review_draft_rollback_constraint() RETURNS text LANGUAGE SQL AS %L','SELECT '||quote_literal(original));
 ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_action_key_check;
 EXECUTE format('ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_action_key_check CHECK ((%s) OR action_key=''verification.draft.saved'')',substring(original from 7));
END $$;
