-- Framework identity and revisions are authoritative; legacy free-text calibration is retained.
CREATE TABLE assurance_framework_revisions (
 framework_version_id TEXT PRIMARY KEY CHECK(framework_version_id ~ '^framework_revision_[A-Za-z0-9_-]{24}$'),
 framework_id TEXT NOT NULL REFERENCES assurance_frameworks(framework_id) ON DELETE RESTRICT,
 version_no INTEGER NOT NULL CHECK(version_no>0),
 framework_reference TEXT NOT NULL,
 title TEXT NOT NULL,
 effective_from TIMESTAMPTZ NOT NULL,
 recorded_by_account_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(framework_id,version_no), UNIQUE(framework_id,framework_version_id)
);
INSERT INTO assurance_framework_revisions(framework_version_id,framework_id,version_no,framework_reference,title,effective_from,recorded_by_account_id,created_at)
 SELECT 'framework_revision_' || substring(framework_id from 11),framework_id,1,framework_reference,title,created_at,created_by_account_id,created_at FROM assurance_frameworks;
CREATE FUNCTION hse_framework_initial_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO assurance_framework_revisions(framework_version_id,framework_id,version_no,framework_reference,title,effective_from,recorded_by_account_id,created_at)
 VALUES('framework_revision_' || substring(NEW.framework_id from 11),NEW.framework_id,1,NEW.framework_reference,NEW.title,NEW.created_at,NEW.created_by_account_id,NEW.created_at);
 RETURN NEW;
END; $$;
CREATE TRIGGER assurance_framework_initial_revision AFTER INSERT ON assurance_frameworks FOR EACH ROW EXECUTE FUNCTION hse_framework_initial_revision();
ALTER TABLE staff_calibrations ADD COLUMN framework_id TEXT NULL REFERENCES assurance_frameworks(framework_id) ON DELETE RESTRICT;
ALTER TABLE staff_calibrations ADD COLUMN framework_version_id TEXT NULL;
ALTER TABLE staff_calibrations ADD COLUMN calibration_sequence BIGINT GENERATED ALWAYS AS IDENTITY;
ALTER TABLE staff_calibrations ADD CONSTRAINT staff_calibration_authoritative_revision_fk FOREIGN KEY(framework_id,framework_version_id) REFERENCES assurance_framework_revisions(framework_id,framework_version_id) ON DELETE RESTRICT;
ALTER TABLE staff_calibrations ADD CONSTRAINT staff_calibration_revision_pair CHECK((framework_id IS NULL)=(framework_version_id IS NULL));
UPDATE staff_calibrations c SET framework_id=r.framework_id,framework_version_id=r.framework_version_id
 FROM assurance_framework_revisions r WHERE c.framework_reference=r.framework_reference AND r.version_no=1 AND r.effective_from<=c.valid_from;
CREATE INDEX staff_calibration_effective_idx ON staff_calibrations(account_id,role,framework_id,framework_version_id,valid_from DESC,calibration_sequence DESC);
CREATE TABLE evidence_review_framework_bindings (
 binding_id TEXT PRIMARY KEY CHECK(binding_id ~ '^review_binding_[A-Za-z0-9_-]{24}$'),
 binding_sequence BIGINT GENERATED ALWAYS AS IDENTITY,
 task_id TEXT NOT NULL REFERENCES evidence_review_tasks(task_id) ON DELETE RESTRICT,
 framework_id TEXT NOT NULL,
 framework_version_id TEXT NOT NULL,
 case_snapshot_id TEXT NULL REFERENCES assurance_case_policy_snapshots(snapshot_id) ON DELETE RESTRICT,
 supersedes_binding_id TEXT NULL REFERENCES evidence_review_framework_bindings(binding_id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(char_length(trim(reason)) BETWEEN 5 AND 2000),
 bound_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 bound_by_session_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(framework_id,framework_version_id) REFERENCES assurance_framework_revisions(framework_id,framework_version_id) ON DELETE RESTRICT
);
CREATE INDEX evidence_review_binding_latest_idx ON evidence_review_framework_bindings(task_id,binding_sequence DESC);
CREATE FUNCTION hse_review_calibration_history_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Framework revisions, review binding and calibration history are append-only.' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER assurance_framework_revision_append_only BEFORE UPDATE OR DELETE ON assurance_framework_revisions FOR EACH ROW EXECUTE FUNCTION hse_review_calibration_history_append_only();
CREATE TRIGGER evidence_review_binding_append_only BEFORE UPDATE OR DELETE ON evidence_review_framework_bindings FOR EACH ROW EXECUTE FUNCTION hse_review_calibration_history_append_only();
CREATE TRIGGER staff_calibration_append_only BEFORE UPDATE OR DELETE ON staff_calibrations FOR EACH ROW EXECUTE FUNCTION hse_review_calibration_history_append_only();
