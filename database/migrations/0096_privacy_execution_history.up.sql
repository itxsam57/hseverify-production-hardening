-- Bounded privacy fulfilment receipts. Existing audit, identity and case history are preserved.
CREATE TABLE privacy_execution_events (
 event_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 operation_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK (event_type IN ('APPROVED','EXECUTED')),
 request_id TEXT NULL REFERENCES privacy_requests(request_id) ON DELETE RESTRICT,
 retention_job_id TEXT NULL REFERENCES retention_jobs(job_id) ON DELETE RESTRICT,
 worker_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 scope TEXT NOT NULL CHECK (scope IN ('profile_contact_city','expired_recording')),
 target_id TEXT NOT NULL,
 actor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 actor_session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 10 AND 2000),
 before_state JSONB NOT NULL CHECK (jsonb_typeof(before_state)='object'),
 after_state JSONB NOT NULL CHECK (jsonb_typeof(after_state)='object'),
 occurred_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(operation_id,event_type),
 CHECK ((request_id IS NOT NULL) <> (retention_job_id IS NOT NULL))
);
CREATE INDEX privacy_execution_request_idx ON privacy_execution_events(request_id,event_sequence);
CREATE INDEX privacy_execution_job_idx ON privacy_execution_events(retention_job_id,event_sequence);
CREATE TRIGGER privacy_execution_events_append_only
 BEFORE UPDATE OR DELETE ON privacy_execution_events
 FOR EACH ROW EXECUTE FUNCTION hse_privacy_consent_append_only();
CREATE FUNCTION hse_privacy_execution_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.event_type='EXECUTED' AND NOT EXISTS(
  SELECT 1 FROM privacy_execution_events approved
  WHERE approved.operation_id=NEW.operation_id AND approved.event_type='APPROVED'
   AND approved.request_id IS NOT DISTINCT FROM NEW.request_id
   AND approved.retention_job_id IS NOT DISTINCT FROM NEW.retention_job_id
   AND approved.worker_id=NEW.worker_id AND approved.scope=NEW.scope AND approved.target_id=NEW.target_id
   AND approved.before_state=NEW.before_state
 ) THEN RAISE EXCEPTION 'Privacy execution requires its immutable matching approval'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER privacy_execution_events_validate BEFORE INSERT ON privacy_execution_events
 FOR EACH ROW EXECUTE FUNCTION hse_privacy_execution_validate();
ALTER TABLE retention_jobs ADD COLUMN execution_result JSONB NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN completed_at TIMESTAMPTZ NULL;
