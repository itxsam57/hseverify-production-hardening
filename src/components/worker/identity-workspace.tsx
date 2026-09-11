"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  requestWorkerIdentityCorrectionAction,
  scheduleWorkerIdentityChecksAction,
  submitWorkerIdentityAction,
  submitWorkerIdentityCorrectionAction,
  uploadWorkerIdentityEvidenceAction,
  withdrawWorkerIdentityAction
} from "@/app/worker/(portal)/identity/actions";
import { saveWorkerIdentityDraftWithRevisionAction } from "@/app/worker/(portal)/identity/save-draft-action";
import {
  INITIAL_WORKER_IDENTITY_ACTION_STATE,
  type WorkerIdentityActionState
} from "@/lib/identity/worker-identity-action-state";
import { INITIAL_WORKER_IDENTITY_DRAFT_SAVE_STATE } from "@/lib/identity/worker-identity-draft-save-state";
import type { WorkerIdentityCorrectionRecord } from "@/lib/identity/worker-identity-correction-domain";
import type { WorkerIdentityDraftRecord } from "@/lib/identity/worker-identity-draft-domain";
import type {
  WorkerIdentityEvidenceBindingRecord,
  WorkerIdentityEvidencePurpose
} from "@/lib/identity/worker-identity-evidence-domain";
import type { WorkerIdentityEligibilityStatus } from "@/lib/identity/worker-identity-eligibility-domain";
import type { WorkerIdentityCheckProjection } from "@/lib/identity/worker-identity-check-repository";
import type {
  WorkerIdentitySnapshot,
  WorkerIdentityStatus
} from "@/lib/identity/worker-identity-domain";

type Props = Readonly<{
  identity: WorkerIdentitySnapshot;
  draft: WorkerIdentityDraftRecord | null;
  evidence: readonly WorkerIdentityEvidenceBindingRecord[];
  checks: WorkerIdentityCheckProjection | null;
  eligibility: WorkerIdentityEligibilityStatus | null;
  correction: WorkerIdentityCorrectionRecord | null;
}>;

const STATUS_LABELS: Readonly<Record<WorkerIdentityStatus, string>> = {
  draft: "Draft",
  submitted: "Submitted",
  automated_checks: "Automated checks",
  manual_review: "Manual review",
  more_info: "More information required",
  rejected: "Rejected",
  escalated: "Escalated",
  verified: "Verified",
  correction_pending: "Correction pending",
  expired_document: "Document expired",
  suspended: "Suspended",
  reinstated: "Reinstated",
  closed: "Closed",
  withdrawn: "Withdrawn"
};

function Feedback({ state }: { state: WorkerIdentityActionState }): React.JSX.Element | null {
  if (state.status === "idle") return null;
  return (
    <p
      className={`profile-action-message profile-action-${state.status}`}
      role={state.status === "error" || state.status === "conflict" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function SubmitButton({
  children,
  secondary = false,
  disabled = false,
  pendingLabel = "Working…"
}: {
  children: React.ReactNode;
  secondary?: boolean;
  disabled?: boolean;
  pendingLabel?: string;
}): React.JSX.Element {
  const { pending } = useFormStatus();
  return (
    <button
      className={secondary ? "button button-secondary" : "button button-primary"}
      type="submit"
      disabled={disabled || pending}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

function useRefreshOnResult(state: WorkerIdentityActionState): void {
  const router = useRouter();
  useEffect(() => {
    if (state.status === "conflict") router.refresh();
  }, [router, state.status]);
}

function activeEvidence(
  evidence: readonly WorkerIdentityEvidenceBindingRecord[],
  purpose: WorkerIdentityEvidencePurpose
): WorkerIdentityEvidenceBindingRecord | null {
  return evidence.find((item) => item.purpose === purpose && item.status === "active") ?? null;
}

function SummaryCard({
  identity,
  eligibility,
  correction
}: Pick<Props, "identity" | "eligibility" | "correction">): React.JSX.Element {
  const status = identity.identity.lifecycleStatus;
  return (
    <section className="profile-submit-card" aria-labelledby="identity-status-heading">
      <div>
        <p className="section-kicker">Current assurance state</p>
        <h2 id="identity-status-heading">{STATUS_LABELS[status]}</h2>
        <p>
          Identity version {identity.currentVersion.versionNumber} ·{" "}
          {identity.currentVersion.versionKind === "correction" ? "Correction version" : "Initial version"}
        </p>
      </div>
      <div>
        <p className="section-kicker">Permanent Worker ID</p>
        <strong>{eligibility?.permanentWorkerId ?? "Not issued"}</strong>
        <p>
          {eligibility?.duplicateStatus === "review_required"
            ? "Duplicate/recovery eligibility requires authorized review."
            : eligibility?.duplicateStatus === "clear"
              ? "Duplicate eligibility check is clear."
              : "Duplicate eligibility has not been evaluated yet."}
        </p>
        {correction ? (
          <p>Latest correction: {correction.decision ?? (correction.submittedAt ? "submitted" : "draft")}</p>
        ) : null}
      </div>
    </section>
  );
}

function VerifiedContacts({ draft }: { draft: WorkerIdentityDraftRecord | null }): React.JSX.Element {
  return (
    <section className="profile-correction-card" aria-labelledby="identity-contact-heading">
      <p className="section-kicker">Verified account contacts</p>
      <h2 id="identity-contact-heading">Identity contact binding</h2>
      <p>
        Email and phone come from your verified sign-in account. They are refreshed by the server when identity details are saved and cannot be typed into this form.
      </p>
      <div className="profile-field-grid">
        <label className="profile-field">
          <span>Verified email</span>
          <input value={draft?.verifiedContacts.emailNormalized ?? "Saved after first identity draft"} disabled readOnly />
        </label>
        <label className="profile-field">
          <span>Verified phone</span>
          <input value={draft?.verifiedContacts.phoneE164 ?? "Saved after first identity draft"} disabled readOnly />
        </label>
      </div>
    </section>
  );
}

function IdentityDetailsForm({
  identity,
  draft
}: Pick<Props, "identity" | "draft">): React.JSX.Element {
  const [state, action] = useActionState(
    saveWorkerIdentityDraftWithRevisionAction,
    INITIAL_WORKER_IDENTITY_DRAFT_SAVE_STATE
  );
  useRefreshOnResult(state);
  const editable =
    identity.currentVersion.versionStatus === "draft" &&
    (identity.identity.lifecycleStatus === "draft" ||
      identity.identity.lifecycleStatus === "correction_pending");
  const effectiveDraftRevision = state.draftRevision ?? draft?.draftRevision ?? null;
  const hasDraft = draft !== null || state.draftRevision !== null;

  return (
    <section className="profile-correction-card" aria-labelledby="identity-details-heading">
      <p className="section-kicker">Legal and personal identity</p>
      <h2 id="identity-details-heading">Identity details</h2>
      <p>
        {editable
          ? "Save partial progress at any time. The current revision prevents one tab from silently overwriting newer changes."
          : "This submitted version is immutable. Verified-detail changes require a correction version."}
      </p>
      <form action={action} className="profile-form" noValidate>
        <input type="hidden" name="hasDraft" value={hasDraft ? "true" : "false"} />
        <input type="hidden" name="expectedDraftRevision" value={effectiveDraftRevision ?? ""} />
        <div className="profile-field-grid">
          <label className="profile-field">
            <span>Legal first name</span>
            <input name="legalFirstName" defaultValue={draft?.legalFirstName ?? ""} disabled={!editable} required />
          </label>
          <label className="profile-field">
            <span>Legal last name</span>
            <input name="legalLastName" defaultValue={draft?.legalLastName ?? ""} disabled={!editable} required />
          </label>
          <label className="profile-field profile-field-wide">
            <span>Previous legal name <small>Optional</small></span>
            <input name="previousLegalName" defaultValue={draft?.previousLegalName ?? ""} disabled={!editable} />
          </label>
          <label className="profile-field">
            <span>Date of birth</span>
            <input type="date" name="dateOfBirth" defaultValue={draft?.dateOfBirth ?? ""} disabled={!editable} required />
          </label>
          <label className="profile-field">
            <span>Nationality</span>
            <input name="nationality" defaultValue={draft?.nationality ?? ""} disabled={!editable} required />
          </label>
          <label className="profile-field">
            <span>Country of residence</span>
            <input name="countryOfResidence" defaultValue={draft?.countryOfResidence ?? ""} disabled={!editable} required />
          </label>
        </div>
        <Feedback state={state} />
        {editable ? (
          <div className="profile-form-actions">
            <SubmitButton pendingLabel="Saving…">Save identity details</SubmitButton>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function EvidenceUploadCard({
  purpose,
  title,
  help,
  binding,
  editable
}: {
  purpose: WorkerIdentityEvidencePurpose;
  title: string;
  help: string;
  binding: WorkerIdentityEvidenceBindingRecord | null;
  editable: boolean;
}): React.JSX.Element {
  const [state, action] = useActionState(
    uploadWorkerIdentityEvidenceAction,
    INITIAL_WORKER_IDENTITY_ACTION_STATE
  );
  useRefreshOnResult(state);
  const isDocument = purpose === "identity_document";

  return (
    <section className="profile-correction-card" aria-labelledby={`${purpose}-heading`}>
      <p className="section-kicker">{binding ? "Evidence attached" : "Evidence required"}</p>
      <h3 id={`${purpose}-heading`}>{title}</h3>
      <p>{help}</p>
      {binding ? (
        <p>
          Current evidence recorded {new Date(binding.createdAt).toLocaleDateString()}.
          {binding.documentType ? ` ${binding.documentType.replaceAll("_", " ")}.` : ""}
        </p>
      ) : null}
      {editable ? (
        <form action={action} className="profile-form" noValidate>
          <input type="hidden" name="purpose" value={purpose} />
          <input type="hidden" name="expectedActiveBindingId" value={binding?.bindingId ?? ""} />
          {isDocument ? (
            <div className="profile-field-grid">
              <label className="profile-field">
                <span>Document type</span>
                <select name="documentType" defaultValue={binding?.documentType ?? ""} required>
                  <option value="">Select type</option>
                  <option value="passport">Passport</option>
                  <option value="national_id">National ID</option>
                  <option value="residence_permit">Residence permit</option>
                </select>
              </label>
              <label className="profile-field">
                <span>Document number</span>
                <input name="documentNumber" defaultValue={binding?.documentNumber ?? ""} required />
              </label>
              <label className="profile-field">
                <span>Issue date <small>Optional</small></span>
                <input type="date" name="issueDate" defaultValue={binding?.issueDate ?? ""} />
              </label>
              <label className="profile-field">
                <span>Expiry date <small>Optional</small></span>
                <input type="date" name="expiryDate" defaultValue={binding?.expiryDate ?? ""} />
              </label>
            </div>
          ) : null}
          <label className="profile-field profile-field-wide">
            <span>{binding ? "Replace file" : "Choose file"}</span>
            <input
              type="file"
              name="file"
              accept={
                isDocument
                  ? ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  : ".png,.jpg,.jpeg,image/png,image/jpeg"
              }
              required
            />
            <small>
              Maximum 10 MB. Files remain private and must pass structural validation and malware scanning before binding.
            </small>
          </label>
          <Feedback state={state} />
          <div className="profile-form-actions">
            <SubmitButton pendingLabel="Uploading and scanning…">
              {binding ? "Replace evidence" : "Upload evidence"}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <p>Evidence is frozen with this submitted identity version.</p>
      )}
    </section>
  );
}

function EvidenceSection({
  identity,
  evidence
}: Pick<Props, "identity" | "evidence">): React.JSX.Element {
  const editable =
    identity.currentVersion.versionStatus === "draft" &&
    (identity.identity.lifecycleStatus === "draft" ||
      identity.identity.lifecycleStatus === "correction_pending");
  return (
    <section aria-labelledby="identity-evidence-heading">
      <div className="profile-page-heading">
        <div>
          <p className="section-kicker">Private evidence</p>
          <h2 id="identity-evidence-heading">Identity evidence</h2>
          <p>Each active version needs an identity document, profile photo and selfie before it can be submitted.</p>
        </div>
      </div>
      <div className="profile-field-grid">
        <EvidenceUploadCard
          purpose="identity_document"
          title="Identity document"
          help="Upload a valid passport, national ID or residence permit as PDF, PNG or JPEG."
          binding={activeEvidence(evidence, "identity_document")}
          editable={editable}
        />
        <EvidenceUploadCard
          purpose="profile_photo"
          title="Profile photo"
          help="Upload a clear PNG or JPEG portrait used as identity evidence."
          binding={activeEvidence(evidence, "profile_photo")}
          editable={editable}
        />
        <EvidenceUploadCard
          purpose="selfie"
          title="Selfie evidence"
          help="Upload a current PNG or JPEG selfie. Production liveness remains provider-backed and fail-closed until configured."
          binding={activeEvidence(evidence, "selfie")}
          editable={editable}
        />
      </div>
    </section>
  );
}

function SubmissionControls({ identity }: Pick<Props, "identity">): React.JSX.Element | null {
  const [submitState, submitAction] = useActionState(
    submitWorkerIdentityAction,
    INITIAL_WORKER_IDENTITY_ACTION_STATE
  );
  const [withdrawState, withdrawAction] = useActionState(
    withdrawWorkerIdentityAction,
    INITIAL_WORKER_IDENTITY_ACTION_STATE
  );
  useRefreshOnResult(submitState);
  useRefreshOnResult(withdrawState);

  if (identity.identity.lifecycleStatus === "draft") {
    return (
      <form action={submitAction} className="profile-submit-card">
        <input type="hidden" name="expectedLockVersion" value={identity.identity.lockVersion} />
        <div>
          <strong>Submit identity for assurance</strong>
          <p>
            The server will block submission unless personal details, verified contacts and all three clean evidence items are complete.
          </p>
          <Feedback state={submitState} />
        </div>
        <SubmitButton pendingLabel="Submitting…">Submit identity</SubmitButton>
      </form>
    );
  }

  if (identity.identity.lifecycleStatus === "submitted") {
    return (
      <form action={withdrawAction} className="profile-submit-card">
        <input type="hidden" name="expectedLockVersion" value={identity.identity.lockVersion} />
        <div>
          <strong>Submitted, not yet under review</strong>
          <p>You can withdraw only before automated/manual review begins.</p>
          <Feedback state={withdrawState} />
        </div>
        <SubmitButton secondary pendingLabel="Withdrawing…">Withdraw submission</SubmitButton>
      </form>
    );
  }
  return null;
}

function AutomatedChecks({
  identity,
  checks
}: Pick<Props, "identity" | "checks">): React.JSX.Element {
  const [state, action] = useActionState(
    scheduleWorkerIdentityChecksAction,
    INITIAL_WORKER_IDENTITY_ACTION_STATE
  );
  useRefreshOnResult(state);
  const canSchedule = identity.identity.lifecycleStatus === "submitted";

  return (
    <section className="profile-correction-card" aria-labelledby="automated-check-heading">
      <p className="section-kicker">Assistive checks</p>
      <h2 id="automated-check-heading">Automated identity checks</h2>
      <p>
        Automated document consistency, face comparison and liveness signals assist review. They never make the final verification, rejection or duplicate-merge decision by themselves.
      </p>
      {checks ? (
        <div>
          <p>Run status: <strong>{checks.run.runStatus.replaceAll("_", " ")}</strong></p>
          {checks.run.failureCode ? <p>Provider result: {checks.run.failureCode.replaceAll("_", " ")}</p> : null}
          {checks.results.length > 0 ? (
            <ul>
              {checks.results.map((result) => (
                <li key={result.checkType}>
                  {result.checkType.replaceAll("_", " ")}: {result.outcome.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p>No automated-check run has been recorded for this identity version.</p>
      )}
      <Feedback state={state} />
      {canSchedule ? (
        <form action={action} className="profile-form-actions">
          <SubmitButton pendingLabel="Scheduling checks…">Run automated checks</SubmitButton>
        </form>
      ) : null}
      {checks?.run.runStatus === "provider_unavailable" ? (
        <p role="status">
          An approved production identity-check provider is not configured. The identity remains safely pending rather than being auto-approved.
        </p>
      ) : null}
    </section>
  );
}

function CorrectionControls({
  identity,
  correction
}: Pick<Props, "identity" | "correction">): React.JSX.Element | null {
  const [requestState, requestAction] = useActionState(
    requestWorkerIdentityCorrectionAction,
    INITIAL_WORKER_IDENTITY_ACTION_STATE
  );
  const [submitState, submitAction] = useActionState(
    submitWorkerIdentityCorrectionAction,
    INITIAL_WORKER_IDENTITY_ACTION_STATE
  );
  useRefreshOnResult(requestState);
  useRefreshOnResult(submitState);

  if (identity.identity.lifecycleStatus === "verified") {
    return (
      <section className="profile-correction-card" aria-labelledby="identity-correction-heading">
        <p className="section-kicker">Verified history</p>
        <h2 id="identity-correction-heading">Request a verified identity correction</h2>
        <p>
          A correction creates a new version. The currently verified version and its evidence remain in history and are never overwritten.
        </p>
        <form action={requestAction} className="profile-form">
          <input type="hidden" name="expectedLockVersion" value={identity.identity.lockVersion} />
          <label className="profile-field profile-field-wide">
            <span>Reason for correction</span>
            <textarea name="reason" minLength={20} maxLength={1000} rows={5} required />
            <small>Describe why the verified identity needs correction. Do not include passwords, OTPs or unrelated secrets.</small>
          </label>
          <Feedback state={requestState} />
          <div className="profile-form-actions">
            <SubmitButton pendingLabel="Creating correction…">Start correction version</SubmitButton>
          </div>
        </form>
      </section>
    );
  }

  if (
    identity.identity.lifecycleStatus === "correction_pending" &&
    identity.currentVersion.versionStatus === "draft"
  ) {
    return (
      <form action={submitAction} className="profile-submit-card">
        <input type="hidden" name="expectedLockVersion" value={identity.identity.lockVersion} />
        <div>
          <strong>Submit correction version</strong>
          <p>
            Complete corrected details and evidence first. Submission freezes this correction version for authorized review while the previous verified version stays preserved in history.
          </p>
          <Feedback state={submitState} />
        </div>
        <SubmitButton pendingLabel="Submitting correction…">Submit correction</SubmitButton>
      </form>
    );
  }

  if (
    identity.identity.lifecycleStatus === "correction_pending" &&
    identity.currentVersion.versionStatus === "submitted"
  ) {
    return (
      <section className="profile-correction-card" aria-labelledby="correction-waiting-heading">
        <p className="section-kicker">Correction submitted</p>
        <h2 id="correction-waiting-heading">Awaiting authorized decision</h2>
        <p>
          The submitted correction is immutable. Reviewer-facing decision controls are intentionally not exposed here; that queue is built in M2.02.
        </p>
      </section>
    );
  }
  return null;
}

export function IdentityWorkspace(props: Props): React.JSX.Element {
  return (
    <div className="profile-sections-stack">
      <SummaryCard identity={props.identity} eligibility={props.eligibility} correction={props.correction} />
      <VerifiedContacts draft={props.draft} />
      <IdentityDetailsForm identity={props.identity} draft={props.draft} />
      <EvidenceSection identity={props.identity} evidence={props.evidence} />
      <SubmissionControls identity={props.identity} />
      <AutomatedChecks identity={props.identity} checks={props.checks} />
      <CorrectionControls identity={props.identity} correction={props.correction} />
    </div>
  );
}
