-- Immutable snapshot of scanned Worker evidence selected when a rejected-case appeal is submitted.
CREATE TABLE assurance_case_appeal_evidence (
 appeal_id TEXT NOT NULL REFERENCES assurance_case_appeals(appeal_id),
 record_id TEXT NOT NULL REFERENCES worker_evidence_records(record_id),
 version_id TEXT NOT NULL REFERENCES worker_evidence_versions(version_id),
 file_id TEXT NOT NULL REFERENCES platform_secure_files(file_id),
 content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 byte_size BIGINT NOT NULL CHECK(byte_size > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(appeal_id,file_id)
);
CREATE INDEX assurance_case_appeal_evidence_record_idx ON assurance_case_appeal_evidence(record_id,version_id);
CREATE FUNCTION retain_case_appeal_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Case appeal evidence snapshots are immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER case_appeal_evidence_immutable BEFORE UPDATE OR DELETE ON assurance_case_appeal_evidence
 FOR EACH ROW EXECUTE FUNCTION retain_case_appeal_evidence();
CREATE FUNCTION validate_case_appeal_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
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
 ) THEN RAISE EXCEPTION 'Case appeal evidence provenance is invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_appeal_evidence_validate BEFORE INSERT ON assurance_case_appeal_evidence
 FOR EACH ROW EXECUTE FUNCTION validate_case_appeal_evidence();
