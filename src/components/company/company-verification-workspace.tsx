"use client";

import { useActionState } from "react";

import {
  saveCompanyVerificationDraftAction,
  startCompanyVerificationCorrectionAction,
  submitCompanyVerificationAction,
  uploadCompanyVerificationEvidenceAction,
  withdrawCompanyVerificationAction
} from "@/app/company/(portal)/settings/profile/actions";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { CompanyVerificationSnapshot } from "@/lib/company/company-verification-domain";
import { INITIAL_COMPANY_VERIFICATION_ACTION_STATE } from "@/lib/ui/action-initial-states";

const REGISTRATION_EVIDENCE_LABEL = "Company registration evidence";

function StatusAlert({
  status,
  message
}: {
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
}): React.JSX.Element | null {
  if (!message) return null;
  return (
    <Alert tone={status === "success" ? "success" : status === "conflict" ? "warning" : "danger"}>
      {message}
    </Alert>
  );
}

function humanStatus(status: CompanyVerificationSnapshot["case"]["caseStatus"]): string {
  switch (status) {
    case "draft": return "Draft";
    case "submitted": return "Submitted";
    case "under_review": return "Under review";
    case "changes_requested": return "Changes requested";
    case "verified": return "Verified";
    case "rejected": return "Rejected";
    case "withdrawn": return "Withdrawn";
  }
}

export function CompanyVerificationWorkspace({
  snapshot
}: {
  snapshot: CompanyVerificationSnapshot;
}): React.JSX.Element {
  const [draftState, draftAction, draftPending] = useActionState(
    saveCompanyVerificationDraftAction,
    INITIAL_COMPANY_VERIFICATION_ACTION_STATE
  );
  const [evidenceState, evidenceAction, evidencePending] = useActionState(
    uploadCompanyVerificationEvidenceAction,
    INITIAL_COMPANY_VERIFICATION_ACTION_STATE
  );
  const [submitState, submitAction, submitPending] = useActionState(
    submitCompanyVerificationAction,
    INITIAL_COMPANY_VERIFICATION_ACTION_STATE
  );
  const [withdrawState, withdrawAction, withdrawPending] = useActionState(
    withdrawCompanyVerificationAction,
    INITIAL_COMPANY_VERIFICATION_ACTION_STATE
  );
  const [correctionState, correctionAction, correctionPending] = useActionState(
    startCompanyVerificationCorrectionAction,
    INITIAL_COMPANY_VERIFICATION_ACTION_STATE
  );

  const version = snapshot.currentVersion;
  const editable = snapshot.case.caseStatus === "draft" && version.versionStatus === "draft";
  const activeRegistrationEvidence = snapshot.evidence.find(
    (item) => item.status === "active" && item.evidenceLabel === REGISTRATION_EVIDENCE_LABEL
  ) ?? null;

  return (
    <div className="content-stack">
      <section className="panel page-section" aria-labelledby="company-verification-status-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Company verification</p>
            <h2 id="company-verification-status-title">{humanStatus(snapshot.case.caseStatus)}</h2>
          </div>
          <span className="status-pill">Version {version.versionNumber}</span>
        </div>
        <p className="muted-copy">
          Company reference: {snapshot.case.caseId}. Duplicate status: {snapshot.duplicateStatus.replaceAll("_", " ")}.
        </p>
        {snapshot.case.caseStatus !== "verified" ? (
          <Alert tone="warning">
            This Company tenant is pending verification. Tenant-scoped workforce operations remain disabled until a server-authorized verification decision activates the tenant.
          </Alert>
        ) : (
          <Alert tone="success">Company verification is accepted and the tenant is active.</Alert>
        )}
      </section>

      <section className="panel page-section" aria-labelledby="company-details-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Organization profile</p>
            <h2 id="company-details-title">Registration details</h2>
          </div>
        </div>
        <StatusAlert status={draftState.status} message={draftState.message} />
        <form action={draftAction} className="profile-form" noValidate>
          <input type="hidden" name="expectedDraftRevision" value={version.draftRevision} />
          <Field htmlFor="legalName" label="Legal Company name">
            <Input id="legalName" name="legalName" defaultValue={version.legalName ?? ""} maxLength={180} required readOnly={!editable} />
          </Field>
          <Field htmlFor="tradingName" label="Trading name">
            <Input id="tradingName" name="tradingName" defaultValue={version.tradingName ?? ""} maxLength={180} required readOnly={!editable} />
          </Field>
          <Field htmlFor="registrationNumber" label="Registration number">
            <Input id="registrationNumber" name="registrationNumber" defaultValue={version.registrationNumber ?? ""} maxLength={120} required readOnly={!editable} />
          </Field>
          <Field htmlFor="country" label="Registration country">
            <Input id="country" name="country" defaultValue={version.country ?? ""} maxLength={120} required readOnly={!editable} />
          </Field>
          <Field htmlFor="industry" label="Industry">
            <Input id="industry" name="industry" defaultValue={version.industry ?? ""} maxLength={160} required readOnly={!editable} />
          </Field>
          <Field htmlFor="companySize" label="Company size">
            <Select id="companySize" name="companySize" defaultValue={version.companySize ?? ""} required disabled={!editable}>
              <option disabled value="">Select Company size</option>
              <option value="1-10">1–10</option>
              <option value="11-50">11–50</option>
              <option value="51-200">51–200</option>
              <option value="201-500">201–500</option>
              <option value="501-1000">501–1,000</option>
              <option value="1001-5000">1,001–5,000</option>
              <option value="5001+">5,001+</option>
            </Select>
          </Field>
          <Field htmlFor="website" label="Company website">
            <Input id="website" name="website" type="url" defaultValue={version.website ?? ""} maxLength={240} required readOnly={!editable} />
          </Field>
          <Field htmlFor="authorizedRepresentative" label="Authorized representative">
            <Input id="authorizedRepresentative" name="authorizedRepresentative" defaultValue={version.authorizedRepresentative ?? ""} maxLength={160} required readOnly={!editable} />
          </Field>
          <Field hint="Verified during Company account registration and never browser-authoritative here." htmlFor="businessEmail" label="Verified business email">
            <Input id="businessEmail" value={version.businessEmail ?? ""} readOnly disabled />
          </Field>
          <Field htmlFor="businessPhone" label="Business phone">
            <Input id="businessPhone" name="businessPhone" type="tel" defaultValue={version.businessPhone ?? ""} maxLength={20} required readOnly={!editable} />
          </Field>
          {editable ? (
            <Button disabled={draftPending} type="submit">
              {draftPending ? "Saving…" : "Save Company details"}
            </Button>
          ) : null}
        </form>
      </section>

      <section className="panel page-section" aria-labelledby="company-evidence-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Private evidence</p>
            <h2 id="company-evidence-title">Company registration evidence</h2>
          </div>
          <span className="status-pill">{activeRegistrationEvidence ? "Attached" : "Required"}</span>
        </div>
        <p className="muted-copy">
          Upload a registration certificate or equivalent organization evidence. PDF, PNG and JPEG are accepted up to 10 MB and pass through the existing quarantine and malware-scan pipeline.
        </p>
        {activeRegistrationEvidence ? (
          <Alert tone="success">Evidence attached to Company verification version {version.versionNumber}.</Alert>
        ) : null}
        <StatusAlert status={evidenceState.status} message={evidenceState.message} />
        {editable ? (
          <form action={evidenceAction} className="profile-form" noValidate>
            <input type="hidden" name="evidenceLabel" value={REGISTRATION_EVIDENCE_LABEL} />
            <input type="hidden" name="expectedActiveBindingId" value={activeRegistrationEvidence?.bindingId ?? ""} />
            <Field
              error={evidenceState.fieldErrors.file}
              htmlFor="companyEvidenceFile"
              label={activeRegistrationEvidence ? "Choose replacement evidence file" : "Choose evidence file"}
            >
              <Input id="companyEvidenceFile" name="file" type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" required />
            </Field>
            <Button disabled={evidencePending} type="submit">
              {evidencePending ? "Processing evidence…" : activeRegistrationEvidence ? "Replace evidence" : "Upload evidence"}
            </Button>
          </form>
        ) : null}
      </section>

      <section className="panel page-section" aria-labelledby="company-verification-action-title">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Application action</p>
            <h2 id="company-verification-action-title">Verification lifecycle</h2>
          </div>
        </div>
        <StatusAlert status={submitState.status} message={submitState.message} />
        <StatusAlert status={withdrawState.status} message={withdrawState.message} />
        <StatusAlert status={correctionState.status} message={correctionState.message} />
        {snapshot.case.caseStatus === "draft" ? (
          <form action={submitAction}>
            <input type="hidden" name="expectedLockVersion" value={snapshot.case.lockVersion} />
            <Button disabled={submitPending} type="submit">
              {submitPending ? "Submitting…" : "Submit Company verification"}
            </Button>
          </form>
        ) : null}
        {snapshot.case.caseStatus === "submitted" ? (
          <form action={withdrawAction}>
            <input type="hidden" name="expectedLockVersion" value={snapshot.case.lockVersion} />
            <Button disabled={withdrawPending} type="submit" variant="danger">
              {withdrawPending ? "Withdrawing…" : "Withdraw before review"}
            </Button>
          </form>
        ) : null}
        {snapshot.case.caseStatus === "changes_requested" ? (
          <form action={correctionAction}>
            <input type="hidden" name="expectedLockVersion" value={snapshot.case.lockVersion} />
            <Button disabled={correctionPending} type="submit">
              {correctionPending ? "Creating version…" : "Create correction version"}
            </Button>
          </form>
        ) : null}
        {snapshot.case.caseStatus === "under_review" ? (
          <Alert tone="neutral">Verification review is in progress. Submitted details and evidence cannot be edited.</Alert>
        ) : null}
        {snapshot.case.caseStatus === "rejected" ? (
          <Alert tone="danger">This Company verification version was rejected. The accepted history remains immutable.</Alert>
        ) : null}
        {snapshot.case.caseStatus === "withdrawn" ? (
          <Alert tone="warning">This application was withdrawn. Audit and duplicate-protection history has been retained.</Alert>
        ) : null}
      </section>
    </div>
  );
}
