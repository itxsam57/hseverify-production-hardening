CREATE TABLE credential_replacements (
  replacement_id TEXT PRIMARY KEY,
  disposition TEXT NOT NULL DEFAULT 'REPLACED' CHECK (disposition = 'REPLACED'),
  appeal_id TEXT NOT NULL UNIQUE REFERENCES credential_appeals(appeal_id),
  tenant_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  old_case_id TEXT NOT NULL REFERENCES assurance_cases(case_id),
  new_case_id TEXT NOT NULL UNIQUE REFERENCES assurance_cases(case_id),
  old_decision_id TEXT NOT NULL REFERENCES platform_decisions(decision_id),
  new_decision_id TEXT NOT NULL UNIQUE REFERENCES platform_decisions(decision_id),
  old_credential_id TEXT NOT NULL UNIQUE REFERENCES credential_issuances(credential_id),
  new_credential_id TEXT NOT NULL UNIQUE REFERENCES credential_issuances(credential_id),
  policy_snapshot_id TEXT NOT NULL REFERENCES assurance_case_policy_snapshots(snapshot_id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  actor_account_id TEXT NOT NULL,
  replaced_at TIMESTAMPTZ NOT NULL,
  CHECK (old_case_id <> new_case_id),
  CHECK (old_decision_id <> new_decision_id),
  CHECK (old_credential_id <> new_credential_id)
);

CREATE FUNCTION validate_credential_replacement_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM credential_appeals appeal
    JOIN assurance_cases old_case ON old_case.case_id=NEW.old_case_id
    JOIN assurance_cases new_case ON new_case.case_id=NEW.new_case_id
    JOIN credential_issuances old_credential ON old_credential.credential_id=NEW.old_credential_id
    JOIN credential_issuances new_credential ON new_credential.credential_id=NEW.new_credential_id
    JOIN assurance_case_policy_snapshots snapshot ON snapshot.snapshot_id=NEW.policy_snapshot_id
    JOIN platform_decisions old_decision ON old_decision.decision_id=NEW.old_decision_id
    JOIN platform_decisions new_decision ON new_decision.decision_id=NEW.new_decision_id
    WHERE appeal.appeal_id=NEW.appeal_id AND appeal.credential_id=NEW.old_credential_id
      AND appeal.worker_id=NEW.worker_id AND appeal.status='accepted' AND appeal.outcome_action IN ('renew','reassessment')
      AND old_case.tenant_id=NEW.tenant_id AND new_case.tenant_id=NEW.tenant_id
      AND old_case.worker_account_id=new_case.worker_account_id
      AND old_case.worker_account_id<>appeal.reviewer_account_id
      AND old_case.permanent_worker_id=NEW.worker_id AND new_case.permanent_worker_id=NEW.worker_id
      AND old_case.credential_reference=NEW.old_credential_id AND new_case.credential_reference=NEW.new_credential_id
      AND old_case.decision_reference=NEW.old_decision_id AND new_case.decision_reference=NEW.new_decision_id
      AND old_decision.case_id=NEW.old_case_id AND new_decision.case_id=NEW.new_case_id
      AND old_decision.tenant_id=NEW.tenant_id AND new_decision.tenant_id=NEW.tenant_id
      AND new_decision.state IN ('APPROVED','CONDITIONALLY_APPROVED')
      AND old_credential.worker_id=NEW.worker_id AND new_credential.worker_id=NEW.worker_id
      AND old_credential.status<>'revoked' AND new_credential.status='valid'
      AND new_credential.issued_at=NEW.replaced_at AND new_decision.created_at=NEW.replaced_at
      AND snapshot.case_id=NEW.new_case_id AND snapshot.tenant_id=NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Credential replacement provenance is invalid.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM credential_appeals WHERE appeal_id=NEW.appeal_id AND outcome_action='renew') THEN
    IF NOT EXISTS(SELECT 1 FROM credential_appeals appeal
      JOIN assurance_case_policy_snapshots pin ON pin.snapshot_id=NEW.policy_snapshot_id
      WHERE appeal.appeal_id=NEW.appeal_id AND appeal.reviewer_account_id=NEW.actor_account_id
        AND appeal.reviewed_at=NEW.replaced_at AND pin.reference_time=NEW.replaced_at)
    THEN RAISE EXCEPTION 'Renewal replacement review provenance is invalid.' USING ERRCODE='23514'; END IF;
  ELSE
    -- This branch resolves only after 0101 exists; renewal on earlier migration ceilings never queries it.
    IF NOT EXISTS(SELECT 1 FROM worker_assessment_reassessment_sources source
      JOIN worker_assessment_applications application USING(application_id)
      JOIN credential_appeals appeal ON appeal.appeal_id=source.source_appeal_id
      JOIN assurance_cases new_case ON new_case.case_id=application.assurance_case_id
      JOIN assurance_case_policy_snapshots pin ON pin.snapshot_id=NEW.policy_snapshot_id
      WHERE source.source_appeal_id=NEW.appeal_id AND source.source_appeal_version=appeal.version
        AND source.source_case_id=NEW.old_case_id AND source.source_tenant_id=NEW.tenant_id
        AND source.source_credential_id=NEW.old_credential_id AND source.source_decision_id=NEW.old_decision_id
        AND source.permanent_worker_id=NEW.worker_id AND source.worker_account_id=new_case.worker_account_id
        AND source.worker_account_id<>NEW.actor_account_id AND new_case.worker_link_id=source.worker_link_id
        AND application.application_status='CASE_CREATED' AND application.assurance_case_id=NEW.new_case_id
        AND pin.framework_id=source.source_framework_id AND pin.reference_time>=source.created_at
        AND pin.reference_time<=NEW.replaced_at AND appeal.reviewed_at<=NEW.replaced_at
        AND appeal.outcome_action='reassessment' AND appeal.status='accepted')
    THEN RAISE EXCEPTION 'Reassessment replacement source provenance is invalid.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credential_replacements_provenance BEFORE INSERT ON credential_replacements
FOR EACH ROW EXECUTE FUNCTION validate_credential_replacement_provenance();

CREATE FUNCTION retain_credential_replacement_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Credential replacement events are immutable.' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER credential_replacements_immutable BEFORE UPDATE OR DELETE ON credential_replacements
FOR EACH ROW EXECUTE FUNCTION retain_credential_replacement_event();

CREATE FUNCTION prevent_replaced_credential_reactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status<>'revoked' AND EXISTS(SELECT 1 FROM credential_replacements WHERE old_credential_id=OLD.credential_id)
  THEN RAISE EXCEPTION 'A replaced credential cannot be reactivated.' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credential_issuances_replacement_terminal BEFORE UPDATE OF status ON credential_issuances
FOR EACH ROW EXECUTE FUNCTION prevent_replaced_credential_reactivation();
