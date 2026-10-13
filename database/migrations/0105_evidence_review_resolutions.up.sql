CREATE TABLE evidence_review_resolution_events(
 event_id text PRIMARY KEY,
 task_id text NOT NULL REFERENCES evidence_review_tasks(task_id),
 source_version_id text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 actor_account_id text NOT NULL REFERENCES auth_accounts(account_id),
 actor_role text NOT NULL CHECK(actor_role IN ('verifier','admin')),
 outcome text NOT NULL CHECK(outcome IN ('UNABLE_TO_VERIFY','ESCALATED','RETURNED_TO_QUEUE')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 4000),
 attempted_methods text NULL CHECK(attempted_methods IS NULL OR length(attempted_methods) BETWEEN 5 AND 4000),
 limitations text NULL CHECK(limitations IS NULL OR length(limitations) BETWEEN 5 AND 4000),
 destination text NULL CHECK(destination IS NULL OR destination='admin'),
 occurred_at timestamptz NOT NULL,
 UNIQUE(task_id,revision),
 CHECK((outcome='UNABLE_TO_VERIFY' AND actor_role='verifier' AND attempted_methods IS NOT NULL AND limitations IS NOT NULL AND destination IS NULL)
 OR(outcome='ESCALATED' AND actor_role='verifier' AND destination='admin')
 OR(outcome='RETURNED_TO_QUEUE' AND actor_role='admin' AND destination IS NULL))
);
CREATE TRIGGER evidence_review_resolutions_append_only BEFORE UPDATE OR DELETE ON evidence_review_resolution_events FOR EACH ROW EXECUTE FUNCTION hse_evidence_review_history_append_only();
DO $$ DECLARE item RECORD; original TEXT; originals JSONB:='[]'::jsonb; BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('evidence_review_tasks','evidence_review_tasks_task_status_check','task_status IN (''UNABLE_TO_VERIFY'',''ESCALATED'')'),
 ('evidence_review_tasks','evidence_review_tasks_check','task_status IN (''UNABLE_TO_VERIFY'',''ESCALATED'') AND assigned_verifier_account_id IS NOT NULL AND claimed_at IS NOT NULL AND decided_at IS NOT NULL'),
 ('platform_audit_events','platform_audit_events_action_key_check','action_key IN (''verification.resolution.recorded'',''verification.escalation.returned'')')
 ) AS x(table_name,constraint_name,extension) LOOP
 SELECT pg_get_constraintdef(oid) INTO original FROM pg_constraint WHERE conrelid=item.table_name::regclass AND conname=item.constraint_name;
 IF original IS NULL THEN RAISE EXCEPTION 'Review constraint missing: %',item.constraint_name; END IF;
 originals:=originals||jsonb_build_array(jsonb_build_object('table',item.table_name,'constraint',item.constraint_name,'definition',original));
 EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
 EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR (%s))',item.table_name,item.constraint_name,substring(original from 7),item.extension);
 END LOOP;
 EXECUTE format('CREATE FUNCTION hse_review_resolution_rollback_contract() RETURNS jsonb LANGUAGE SQL AS %L','SELECT '||quote_literal(originals::text)||'::jsonb');
END $$;
