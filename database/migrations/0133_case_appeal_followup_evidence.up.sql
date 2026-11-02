-- Additional evidence requests and responses for independent rejected-case appeals.
CREATE TABLE assurance_case_appeal_evidence_requests (
 request_id TEXT PRIMARY KEY CHECK(request_id ~ '^case_followup_[A-Za-z0-9_-]{24}$'),
 appeal_id TEXT NOT NULL REFERENCES assurance_case_appeals(appeal_id),
 appeal_version INTEGER NOT NULL CHECK(appeal_version>1),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 4000),
 requested_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(appeal_id,appeal_version)
);
CREATE TABLE assurance_case_appeal_evidence_responses (
 request_id TEXT PRIMARY KEY REFERENCES assurance_case_appeal_evidence_requests(request_id),
 appeal_id TEXT NOT NULL REFERENCES assurance_case_appeals(appeal_id),
 appeal_version INTEGER NOT NULL CHECK(appeal_version>2),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 4000),
 responded_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(appeal_id,appeal_version)
);
ALTER TABLE assurance_case_appeal_evidence
 ADD COLUMN request_id TEXT REFERENCES assurance_case_appeal_evidence_requests(request_id);
CREATE INDEX case_appeal_evidence_request_idx ON assurance_case_appeal_evidence(request_id) WHERE request_id IS NOT NULL;

CREATE FUNCTION guard_case_appeal_evidence_followup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
 SELECT 1 FROM assurance_case_appeal_evidence_requests request
 JOIN assurance_case_appeal_evidence_responses response
 ON response.request_id=request.request_id AND response.appeal_id=request.appeal_id
 JOIN assurance_case_appeals appeal ON appeal.appeal_id=request.appeal_id
 WHERE request.request_id=NEW.request_id AND request.appeal_id=NEW.appeal_id
 AND response.appeal_version=appeal.version AND appeal.status='under_review'
 AND response.responded_by_account_id=appeal.worker_account_id
 ) THEN RAISE EXCEPTION 'Case appeal followup evidence source is invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_appeal_followup_evidence_guard BEFORE INSERT ON assurance_case_appeal_evidence
 FOR EACH ROW WHEN(NEW.request_id IS NOT NULL) EXECUTE FUNCTION guard_case_appeal_evidence_followup();

CREATE OR REPLACE FUNCTION validate_case_appeal_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM assurance_case_appeals appeal
  JOIN worker_evidence_records records ON records.record_id=NEW.record_id AND records.worker_account_id=appeal.worker_account_id
  JOIN worker_evidence_versions versions ON versions.version_id=NEW.version_id AND versions.record_id=records.record_id
   AND versions.version_status='submitted' AND records.current_version_id=versions.version_id
  JOIN worker_evidence_attachments attachment ON attachment.record_id=records.record_id
   AND attachment.version_id=versions.version_id AND attachment.secure_file_id=NEW.file_id AND attachment.superseded_at IS NULL
  JOIN platform_secure_files files ON files.file_id=attachment.secure_file_id AND files.owner_account_id=appeal.worker_account_id
    AND files.owner_role='worker' AND files.lifecycle_status='available'
    AND files.content_sha256=NEW.content_sha256 AND files.byte_size=NEW.byte_size
  WHERE appeal.appeal_id=NEW.appeal_id
    AND ((NEW.request_id IS NULL AND appeal.status='submitted' AND appeal.version=1)
      OR (NEW.request_id IS NOT NULL AND appeal.status='under_review'))
    AND records.lifecycle_status<>'inactive'
 ) THEN RAISE EXCEPTION 'Case appeal evidence provenance is invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION retain_case_appeal_followups() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Case appeal followup history is immutable' USING ERRCODE='55000';END $$;
CREATE TRIGGER case_appeal_request_immutable BEFORE UPDATE OR DELETE ON assurance_case_appeal_evidence_requests
 FOR EACH ROW EXECUTE FUNCTION retain_case_appeal_followups();
CREATE TRIGGER case_appeal_response_immutable BEFORE UPDATE OR DELETE ON assurance_case_appeal_evidence_responses
 FOR EACH ROW EXECUTE FUNCTION retain_case_appeal_followups();

CREATE FUNCTION guard_case_appeal_pending_followups() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('accepted','rejected') AND EXISTS (
  SELECT 1 FROM assurance_case_appeal_evidence_requests request
  WHERE request.appeal_id=NEW.appeal_id AND NOT EXISTS (
   SELECT 1 FROM assurance_case_appeal_evidence_responses response
    WHERE response.request_id=request.request_id)
 ) THEN RAISE EXCEPTION 'Unresolved case appeal followup evidence request' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_appeal_pending_followup_guard BEFORE UPDATE OF status ON assurance_case_appeals
 FOR EACH ROW EXECUTE FUNCTION guard_case_appeal_pending_followups();
