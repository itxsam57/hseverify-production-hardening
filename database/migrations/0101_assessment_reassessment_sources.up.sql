CREATE TABLE worker_assessment_reassessment_sources (
 application_id TEXT PRIMARY KEY REFERENCES worker_assessment_applications(application_id),
 source_appeal_id TEXT NOT NULL REFERENCES credential_appeals(appeal_id),
 source_appeal_version INTEGER NOT NULL CHECK(source_appeal_version>0),
 source_case_id TEXT NOT NULL REFERENCES assurance_cases(case_id),
 source_tenant_id TEXT NOT NULL,
 source_framework_id TEXT NOT NULL REFERENCES assurance_frameworks(framework_id),
 source_credential_id TEXT NOT NULL REFERENCES credential_issuances(credential_id),
 source_decision_id TEXT NOT NULL REFERENCES platform_decisions(decision_id),
 worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 permanent_worker_id TEXT NOT NULL, worker_link_id TEXT NOT NULL,
 actor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX worker_assessment_reassessment_source_appeal_idx ON worker_assessment_reassessment_sources(source_appeal_id);
CREATE FUNCTION validate_assessment_reassessment_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM worker_assessment_applications application
  JOIN assessment_catalogue_versions catalogue ON catalogue.catalogue_version_id=application.catalogue_version_id
  JOIN credential_appeals appeal ON appeal.appeal_id=NEW.source_appeal_id
  JOIN credential_appeal_events event ON event.appeal_id=appeal.appeal_id AND event.version=NEW.source_appeal_version
  JOIN assurance_cases source ON source.case_id=NEW.source_case_id
  JOIN assurance_case_policy_snapshots pin ON pin.case_id=source.case_id AND pin.tenant_id=source.tenant_id
  JOIN credential_issuances credential ON credential.credential_id=NEW.source_credential_id
  JOIN platform_decisions decision ON decision.decision_id=NEW.source_decision_id
 WHERE application.application_id=NEW.application_id AND application.funding_mode='WORKER_PAY'
  AND application.application_status='PAYMENT_REQUIRED' AND application.worker_account_id=NEW.worker_account_id
  AND application.permanent_worker_id=NEW.permanent_worker_id AND application.created_at=NEW.created_at
  AND NEW.actor_account_id=NEW.worker_account_id AND catalogue.framework_id=NEW.source_framework_id
  AND appeal.status='accepted' AND appeal.outcome_action='reassessment' AND appeal.version=NEW.source_appeal_version
  AND appeal.credential_id=NEW.source_credential_id AND appeal.worker_id=NEW.permanent_worker_id
  AND event.status='accepted' AND event.outcome_action='reassessment'
  AND event.reviewer_account_id=appeal.reviewer_account_id AND event.changed_at=appeal.reviewed_at
  AND source.tenant_id=NEW.source_tenant_id AND source.worker_account_id=NEW.worker_account_id
  AND source.permanent_worker_id=NEW.permanent_worker_id AND source.credential_reference=NEW.source_credential_id
  AND source.decision_reference=NEW.source_decision_id AND pin.framework_id=NEW.source_framework_id
  AND credential.worker_id=NEW.permanent_worker_id AND credential.status<>'revoked'
  AND decision.case_id=source.case_id AND decision.tenant_id=source.tenant_id AND decision.state<>'REVOKED'
  AND EXISTS(SELECT 1 FROM worker_assessment_application_events initial WHERE initial.application_id=application.application_id
    AND initial.from_status IS NULL AND initial.to_status='PAYMENT_REQUIRED' AND initial.actor_role='worker'
    AND initial.actor_account_id=NEW.worker_account_id AND initial.detail_json->>'sourceAppealId'=NEW.source_appeal_id)
  AND NOT EXISTS(SELECT 1 FROM credential_replacements replacement WHERE replacement.old_credential_id=NEW.source_credential_id)
  AND NOT EXISTS(SELECT 1 FROM credential_appeals later WHERE later.credential_id=appeal.credential_id
    AND later.status='accepted' AND later.appeal_id<>appeal.appeal_id AND later.reviewed_at>=appeal.reviewed_at)
  AND EXISTS(SELECT 1 FROM living_record_competencies competency JOIN living_record_versions version ON version.competency_id=competency.competency_id
    WHERE competency.source_credential_id=appeal.credential_id AND version.status='reassessment_required'
      AND version.version=(SELECT MAX(latest.version) FROM living_record_versions latest WHERE latest.competency_id=competency.competency_id))
  AND (NEW.source_tenant_id='tenant_independent_worker_scope' AND NEW.worker_link_id=source.worker_link_id
    OR EXISTS(SELECT 1 FROM company_worker_links link JOIN platform_tenants tenant ON tenant.tenant_id=link.tenant_id
      WHERE link.link_id=NEW.worker_link_id AND link.tenant_id=NEW.source_tenant_id
       AND link.worker_account_id=NEW.worker_account_id AND link.permanent_worker_id=NEW.permanent_worker_id
       AND link.link_status='active' AND tenant.tenant_status='active'))
 ) THEN RAISE EXCEPTION 'Assessment reassessment source provenance is invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER worker_assessment_reassessment_source_validate BEFORE INSERT ON worker_assessment_reassessment_sources
 FOR EACH ROW EXECUTE FUNCTION validate_assessment_reassessment_source();
CREATE FUNCTION retain_assessment_reassessment_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Assessment reassessment sources are immutable' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER worker_assessment_reassessment_source_immutable BEFORE UPDATE OR DELETE ON worker_assessment_reassessment_sources
 FOR EACH ROW EXECUTE FUNCTION retain_assessment_reassessment_source();

CREATE FUNCTION validate_assessment_reassessment_case_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source worker_assessment_reassessment_sources%ROWTYPE;
BEGIN
 SELECT * INTO source FROM worker_assessment_reassessment_sources WHERE application_id=NEW.application_id;
 IF FOUND AND NEW.assurance_case_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM assurance_cases cases JOIN assurance_case_policy_snapshots pin ON pin.case_id=cases.case_id AND pin.tenant_id=cases.tenant_id
   WHERE cases.case_id=NEW.assurance_case_id AND cases.case_id<>source.source_case_id
    AND cases.order_id=NEW.assurance_order_id AND cases.tenant_id=source.source_tenant_id
    AND cases.worker_account_id=source.worker_account_id AND cases.permanent_worker_id=source.permanent_worker_id
    AND cases.worker_link_id=source.worker_link_id AND pin.framework_id=source.source_framework_id
 ) THEN RAISE EXCEPTION 'Assessment reassessment case binding is invalid' USING ERRCODE='23514'; END IF;
 IF FOUND AND OLD.assurance_case_id IS NOT NULL AND NEW.assurance_case_id IS DISTINCT FROM OLD.assurance_case_id
 THEN RAISE EXCEPTION 'Assessment reassessment case binding is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER worker_assessment_reassessment_case_validate BEFORE UPDATE ON worker_assessment_applications
 FOR EACH ROW EXECUTE FUNCTION validate_assessment_reassessment_case_binding();
