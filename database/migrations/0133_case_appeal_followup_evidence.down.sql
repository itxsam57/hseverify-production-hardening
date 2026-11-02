DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM assurance_case_appeal_evidence_requests LIMIT 1)
 OR EXISTS(SELECT 1 FROM assurance_case_appeal_evidence_responses LIMIT 1)
 OR EXISTS(SELECT 1 FROM assurance_case_appeal_evidence WHERE request_id IS NOT NULL LIMIT 1)
 THEN RAISE EXCEPTION 'Case appeal followup histories must be retained' USING ERRCODE='55000';END IF;
END $$;
DROP TRIGGER case_appeal_pending_followup_guard ON assurance_case_appeals;
DROP FUNCTION guard_case_appeal_pending_followups();
DROP TRIGGER case_appeal_followup_evidence_guard ON assurance_case_appeal_evidence;
DROP FUNCTION guard_case_appeal_evidence_followup();
DROP TRIGGER case_appeal_response_immutable ON assurance_case_appeal_evidence_responses;
DROP TRIGGER case_appeal_request_immutable ON assurance_case_appeal_evidence_requests;
DROP FUNCTION retain_case_appeal_followups();
ALTER TABLE assurance_case_appeal_evidence DROP COLUMN request_id;
DROP TABLE assurance_case_appeal_evidence_responses;
DROP TABLE assurance_case_appeal_evidence_requests;
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
  WHERE appeal.appeal_id=NEW.appeal_id AND appeal.status='submitted'
    AND appeal.version=1 AND records.lifecycle_status<>'inactive'
 ) THEN RAISE EXCEPTION 'Case appeal evidence provenance is invalid' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
