-- Explicit trade verification supplements the immutable exact-version review decision.
-- Historical generic approvals remain unverified for trade mapping.
ALTER TABLE evidence_review_decisions
 ADD COLUMN verified_trade TEXT NULL,
 ADD COLUMN verification_method TEXT NULL,
 ADD COLUMN verification_source_file_id TEXT NULL REFERENCES platform_secure_files(file_id),
 ADD CONSTRAINT evidence_review_verified_trade_shape CHECK (
  (verified_trade IS NULL AND verification_method IS NULL AND verification_source_file_id IS NULL)
  OR (verified_trade IS NOT NULL AND char_length(btrim(verified_trade)) BETWEEN 1 AND 160
   AND verified_trade=btrim(verified_trade) AND verification_method IS NOT NULL AND verification_method='evidence_review'
   AND verification_source_file_id IS NOT NULL AND outcome='APPROVED')
 );

CREATE FUNCTION hse_explicit_verified_trade_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE bound RECORD;
BEGIN
 IF NEW.verified_trade IS NULL THEN RETURN NEW; END IF;
 SELECT tasks.worker_account_id,skills.related_trade INTO bound
  FROM evidence_review_tasks tasks
  JOIN worker_evidence_records records ON records.record_id=tasks.source_record_id
   AND records.worker_account_id=tasks.worker_account_id AND records.record_kind='skill'
   AND records.lifecycle_status='active' AND records.current_version_id=tasks.source_version_id
  JOIN worker_evidence_versions versions ON versions.version_id=tasks.source_version_id
   AND versions.record_id=records.record_id AND versions.version_status='submitted'
  JOIN worker_skill_versions skills ON skills.version_id=versions.version_id
  JOIN worker_evidence_attachments attachments ON attachments.record_id=records.record_id
   AND attachments.version_id=versions.version_id AND attachments.secure_file_id=tasks.secure_file_id
   AND attachments.superseded_at IS NULL
  JOIN platform_secure_files files ON files.file_id=attachments.secure_file_id
   AND files.owner_account_id=records.worker_account_id AND files.owner_role='worker'
   AND files.lifecycle_status='available'
  JOIN auth_accounts accounts ON accounts.account_id=tasks.assigned_verifier_account_id AND accounts.account_status='active'
  JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='verifier'
  WHERE tasks.task_id=NEW.task_id AND tasks.task_status='ASSIGNED' AND tasks.evidence_kind='skill'
   AND tasks.source_version_id=NEW.source_version_id AND tasks.assigned_verifier_account_id=NEW.verifier_account_id
   AND tasks.worker_account_id<>NEW.verifier_account_id AND tasks.secure_file_id=NEW.verification_source_file_id
   AND skills.related_trade=NEW.verified_trade
   AND NOT EXISTS(SELECT 1 FROM evidence_review_conflicts conflicts WHERE conflicts.task_id=tasks.task_id
    AND conflicts.verifier_account_id=NEW.verifier_account_id)
   AND ((tasks.case_id IS NULL AND tasks.tenant_id IS NULL) OR EXISTS(
    SELECT 1 FROM assurance_cases cases WHERE cases.case_id=tasks.case_id AND cases.tenant_id=tasks.tenant_id
     AND cases.worker_account_id=tasks.worker_account_id))
  FOR SHARE OF tasks,records,versions,skills,attachments,files,accounts,roles;
 IF NOT FOUND THEN RAISE EXCEPTION 'Explicit trade verification source is unavailable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER evidence_review_explicit_trade_guard BEFORE INSERT ON evidence_review_decisions
 FOR EACH ROW EXECUTE FUNCTION hse_explicit_verified_trade_guard();
