"use client";

import { useActionState } from "react";

import {
  createWorkerEvidenceRecordAction,
  endWorkerEmploymentAction,
  finalizeWorkerEvidenceFileCandidateAction,
  inactivateWorkerSkillAction,
  saveWorkerEvidenceDraftAction,
  startWorkerEvidenceRevisionAction,
  submitWorkerEvidenceAction,
  uploadWorkerEvidenceFileAction,
  uploadWorkerLeavingLetterAction
} from "@/app/worker/(portal)/evidence/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import {
  CheckboxField,
  Field,
  Input,
  Select,
  Textarea
} from "@/components/ui/field";
import { INITIAL_WORKER_EVIDENCE_ACTION_STATE } from "@/lib/worker-evidence/worker-evidence-action-state";
import type {
  EmploymentDetails,
  ExperienceDetails,
  QualificationDetails,
  SkillDetails,
  WorkerEvidenceRecord,
  WorkerEvidenceVersion
} from "@/lib/worker-evidence/worker-evidence-domain";

type WorkspaceAttachment = Readonly<{
  attachmentId: string;
  recordId: string;
  versionId: string;
  attachmentKind: string;
  secureFileId: string;
  displayFilename: string;
  createdAt: string;
  supersededAt: string | null;
}>;

type WorkspaceLeavingLetter = Readonly<{
  leavingLetterId: string;
  employmentRecordId: string;
  employmentVersionId: string;
  secureFileId: string;
  displayFilename: string;
  status: "active" | "superseded";
  supersedesLeavingLetterId: string | null;
  createdAt: string;
  supersededAt: string | null;
}>;

type WorkspacePendingCandidate = Readonly<{
  candidateId: string;
  recordId: string;
  versionId: string;
  bindingKind: string;
  secureFileId: string;
  displayFilename: string;
  expectedActiveBindingId: string | null;
  scanStatus:
    | "reserved"
    | "quarantined"
    | "scan_pending"
    | "available"
    | "unsafe"
    | "scan_failed";
  createdAt: string;
}>;

export type WorkerEvidenceWorkspaceRecord = Omit<
  WorkerEvidenceRecord,
  "workerAccountId"
> &
  Readonly<{
    attachments: readonly WorkspaceAttachment[];
    pendingCandidates: readonly WorkspacePendingCandidate[];
    leavingLetters: readonly WorkspaceLeavingLetter[];
    versions: readonly WorkerEvidenceVersion[];
  }>;

function formatUtc(value: string): string {
  return `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function fieldId(prefix: string, name: string): string {
  return `${prefix}-${name}`;
}

function Feedback({
  state
}: {
  state: typeof INITIAL_WORKER_EVIDENCE_ACTION_STATE;
}): React.JSX.Element | null {
  if (!state.message) return null;
  return (
    <Alert
      tone={
        state.status === "success"
          ? "success"
          : state.status === "conflict"
            ? "warning"
            : "danger"
      }
    >
      {state.message}
    </Alert>
  );
}

function CreateRecordForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(
    createWorkerEvidenceRecordAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  return (
    <section className="panel page-section content-stack">
      <div>
        <p className="eyebrow">Add evidence</p>
        <h2>Create a Worker record</h2>
        <p className="muted-copy">
          Start a separate versioned record. Records are never silently deleted or merged into another form.
        </p>
      </div>
      <Feedback state={state} />
      <form action={action} className="profile-form">
        <Field htmlFor="worker-evidence-new-kind" label="Record type">
          <Select id="worker-evidence-new-kind" name="kind" defaultValue="qualification">
            <option value="qualification">Qualification</option>
            <option value="experience">Experience</option>
            <option value="employment">Employment</option>
            <option value="skill">Skill</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create draft"}
        </Button>
      </form>
    </section>
  );
}

function QualificationFields({
  details,
  prefix
}: {
  details: QualificationDetails;
  prefix: string;
}): React.JSX.Element {
  return (
    <>
      <div className="profile-form-grid">
        <Field htmlFor={fieldId(prefix, "qualification-title")} label="Qualification title">
          <Input id={fieldId(prefix, "qualification-title")} name="title" defaultValue={details.title ?? ""} maxLength={240} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-category")} label="Category">
          <Input id={fieldId(prefix, "qualification-category")} name="category" defaultValue={details.category ?? ""} maxLength={160} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-issuer")} label="Issuing organization">
          <Input id={fieldId(prefix, "qualification-issuer")} name="issuingOrganization" defaultValue={details.issuingOrganization ?? ""} maxLength={240} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-provider")} label="Learning provider" optional>
          <Input id={fieldId(prefix, "qualification-provider")} name="learningProvider" defaultValue={details.learningProvider ?? ""} maxLength={240} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-number")} label="Certificate / candidate number">
          <Input id={fieldId(prefix, "qualification-number")} name="certificateNumber" defaultValue={details.certificateNumber ?? ""} maxLength={160} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-level")} label="Level">
          <Input id={fieldId(prefix, "qualification-level")} name="level" defaultValue={details.level ?? ""} maxLength={120} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-issue-date")} label="Issue date">
          <Input id={fieldId(prefix, "qualification-issue-date")} name="issueDate" type="date" defaultValue={details.issueDate ?? ""} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-expiry-date")} label="Expiry date" optional>
          <Input id={fieldId(prefix, "qualification-expiry-date")} name="expiryDate" type="date" defaultValue={details.expiryDate ?? ""} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-country")} label="Country">
          <Input id={fieldId(prefix, "qualification-country")} name="country" defaultValue={details.country ?? ""} maxLength={120} />
        </Field>
        <Field htmlFor={fieldId(prefix, "qualification-url")} label="Verification URL" optional>
          <Input id={fieldId(prefix, "qualification-url")} name="verificationUrl" type="url" defaultValue={details.verificationUrl ?? ""} maxLength={500} />
        </Field>
      </div>
      <CheckboxField
        name="declarationAccepted"
        defaultChecked={details.declarationAccepted}
        label="I confirm these qualification details and the attached certificate belong to me and are accurate."
      />
    </>
  );
}

function ExperienceFields({
  details,
  prefix
}: {
  details: ExperienceDetails;
  prefix: string;
}): React.JSX.Element {
  return (
    <div className="profile-form-grid">
      <Field htmlFor={fieldId(prefix, "experience-company")} label="Company / organization">
        <Input id={fieldId(prefix, "experience-company")} name="companyName" defaultValue={details.companyName ?? ""} maxLength={240} />
      </Field>
      <Field htmlFor={fieldId(prefix, "experience-role")} label="Role / activity">
        <Input id={fieldId(prefix, "experience-role")} name="roleTitle" defaultValue={details.roleTitle ?? ""} maxLength={240} />
      </Field>
      <Field htmlFor={fieldId(prefix, "experience-country")} label="Country">
        <Input id={fieldId(prefix, "experience-country")} name="country" defaultValue={details.country ?? ""} maxLength={120} />
      </Field>
      <Field htmlFor={fieldId(prefix, "experience-status")} label="Status">
        <Select id={fieldId(prefix, "experience-status")} name="status" defaultValue={details.status}>
          <option value="current">Current</option>
          <option value="ended">Ended</option>
        </Select>
      </Field>
      <Field htmlFor={fieldId(prefix, "experience-start")} label="Start date">
        <Input id={fieldId(prefix, "experience-start")} name="startDate" type="date" defaultValue={details.startDate ?? ""} />
      </Field>
      <Field htmlFor={fieldId(prefix, "experience-end")} label="End date" optional>
        <Input id={fieldId(prefix, "experience-end")} name="endDate" type="date" defaultValue={details.endDate ?? ""} />
      </Field>
      <Field htmlFor={fieldId(prefix, "experience-duties")} label="Duties / experience detail" optional className="profile-field-wide">
        <Textarea id={fieldId(prefix, "experience-duties")} name="duties" defaultValue={details.duties ?? ""} maxLength={4000} rows={5} />
      </Field>
    </div>
  );
}

function EmploymentFields({
  details,
  prefix
}: {
  details: EmploymentDetails;
  prefix: string;
}): React.JSX.Element {
  return (
    <div className="profile-form-grid">
      <input type="hidden" name="status" value="current" />
      <Field htmlFor={fieldId(prefix, "employment-company")} label="Employer">
        <Input id={fieldId(prefix, "employment-company")} name="companyName" defaultValue={details.companyName ?? ""} maxLength={240} />
      </Field>
      <Field htmlFor={fieldId(prefix, "employment-role")} label="Role title">
        <Input id={fieldId(prefix, "employment-role")} name="roleTitle" defaultValue={details.roleTitle ?? ""} maxLength={240} />
      </Field>
      <Field htmlFor={fieldId(prefix, "employment-country")} label="Country">
        <Input id={fieldId(prefix, "employment-country")} name="country" defaultValue={details.country ?? ""} maxLength={120} />
      </Field>
      <Field htmlFor={fieldId(prefix, "employment-start")} label="Start date">
        <Input id={fieldId(prefix, "employment-start")} name="startDate" type="date" defaultValue={details.startDate ?? ""} />
      </Field>
      <Field htmlFor={fieldId(prefix, "employment-duties")} label="Duties" optional className="profile-field-wide">
        <Textarea id={fieldId(prefix, "employment-duties")} name="duties" defaultValue={details.duties ?? ""} maxLength={4000} rows={5} />
      </Field>
    </div>
  );
}

function SkillFields({
  details,
  prefix
}: {
  details: SkillDetails;
  prefix: string;
}): React.JSX.Element {
  return (
    <div className="profile-form-grid">
      <Field htmlFor={fieldId(prefix, "skill-name")} label="Skill">
        <Input id={fieldId(prefix, "skill-name")} name="skillName" defaultValue={details.skillName ?? ""} maxLength={240} />
      </Field>
      <Field htmlFor={fieldId(prefix, "skill-category")} label="Category">
        <Input id={fieldId(prefix, "skill-category")} name="category" defaultValue={details.category ?? ""} maxLength={160} />
      </Field>
      <Field htmlFor={fieldId(prefix, "skill-proficiency")} label="Proficiency claim">
        <Input id={fieldId(prefix, "skill-proficiency")} name="proficiencyClaim" defaultValue={details.proficiencyClaim ?? ""} maxLength={160} />
      </Field>
      <Field htmlFor={fieldId(prefix, "skill-months")} label="Experience (months)">
        <Input id={fieldId(prefix, "skill-months")} name="experienceMonths" type="number" min={0} step={1} defaultValue={details.experienceMonths ?? ""} />
      </Field>
      <Field htmlFor={fieldId(prefix, "skill-trade")} label="Related trade" optional>
        <Input id={fieldId(prefix, "skill-trade")} name="relatedTrade" defaultValue={details.relatedTrade ?? ""} maxLength={160} />
      </Field>
      <div className="ds-field">
        <span className="ds-field-label">Assurance state</span>
        <p className="muted-copy">{details.assuranceStatus.replaceAll("_", " ")}</p>
      </div>
    </div>
  );
}

function DraftMetadataForm({
  record
}: {
  record: WorkerEvidenceWorkspaceRecord;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    saveWorkerEvidenceDraftAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  const prefix = `evidence-${record.recordId}`;
  return (
    <form action={action} className="profile-form" noValidate>
      <input type="hidden" name="recordId" value={record.recordId} />
      <input type="hidden" name="expectedRevision" value={record.currentVersion.revision} />
      {record.kind === "qualification" ? (
        <QualificationFields details={record.currentVersion.details as QualificationDetails} prefix={prefix} />
      ) : record.kind === "experience" ? (
        <ExperienceFields details={record.currentVersion.details as ExperienceDetails} prefix={prefix} />
      ) : record.kind === "employment" ? (
        <EmploymentFields details={record.currentVersion.details as EmploymentDetails} prefix={prefix} />
      ) : (
        <SkillFields details={record.currentVersion.details as SkillDetails} prefix={prefix} />
      )}
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save metadata"}
      </Button>
    </form>
  );
}

function EvidenceFileForm({
  record
}: {
  record: WorkerEvidenceWorkspaceRecord;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    uploadWorkerEvidenceFileAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  const kind =
    record.kind === "qualification"
      ? "primary_certificate"
      : record.kind === "experience"
        ? "experience_evidence"
        : record.kind === "employment"
          ? "employment_evidence"
          : "skill_evidence";
  const active = record.attachments.find(
    (item) =>
      item.versionId === record.currentVersion.versionId &&
      item.attachmentKind === kind &&
      item.supersededAt === null
  );

  return (
    <section className="content-stack" aria-label={`${record.kind} file evidence`}>
      <div>
        <h4>{record.kind === "qualification" ? "Qualification certificate" : "File evidence"}</h4>
        <p className="muted-copy">
          PDF, PNG or JPEG up to 10 MB. Files are quarantined and security-scanned before they can bind to this exact version.
        </p>
      </div>
      <Feedback state={state} />
      <form action={action} className="profile-form">
        <input type="hidden" name="recordId" value={record.recordId} />
        <input type="hidden" name="versionId" value={record.currentVersion.versionId} />
        <input type="hidden" name="expectedActiveAttachmentId" value={active?.attachmentId ?? ""} />
        <Field htmlFor={`evidence-file-${record.recordId}`} label={record.kind === "qualification" ? "Primary certificate file" : "Evidence file"}>
          <Input
            id={`evidence-file-${record.recordId}`}
            name="file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            required
          />
        </Field>
        <Button type="submit" disabled={pending} variant="secondary">
          {pending ? "Uploading…" : active ? "Upload replacement" : "Upload file"}
        </Button>
      </form>
    </section>
  );
}

function SubmitForm({ record }: { record: WorkerEvidenceWorkspaceRecord }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    submitWorkerEvidenceAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  return (
    <form action={action} className="content-stack">
      <input type="hidden" name="recordId" value={record.recordId} />
      <input type="hidden" name="expectedRevision" value={record.currentVersion.revision} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit this version"}
      </Button>
    </form>
  );
}

function StartRevisionForm({ record }: { record: WorkerEvidenceWorkspaceRecord }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    startWorkerEvidenceRevisionAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  return (
    <form action={action} className="content-stack">
      <input type="hidden" name="recordId" value={record.recordId} />
      <input type="hidden" name="expectedRevision" value={record.currentVersion.revision} />
      <Feedback state={state} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Starting revision…" : "Start a new revision"}
      </Button>
    </form>
  );
}

function EndEmploymentForm({ record }: { record: WorkerEvidenceWorkspaceRecord }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    endWorkerEmploymentAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  return (
    <form action={action} className="profile-form">
      <input type="hidden" name="recordId" value={record.recordId} />
      <input type="hidden" name="expectedRevision" value={record.currentVersion.revision} />
      <Field htmlFor={`employment-end-date-${record.recordId}`} label="Employment end date">
        <Input id={`employment-end-date-${record.recordId}`} name="endDate" type="date" required />
      </Field>
      <Field htmlFor={`employment-end-reason-${record.recordId}`} label="End reason" optional>
        <Textarea id={`employment-end-reason-${record.recordId}`} name="endReason" maxLength={1000} rows={3} />
      </Field>
      <Feedback state={state} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Ending employment…" : "End employment and preserve history"}
      </Button>
    </form>
  );
}

function InactivateSkillForm({ record }: { record: WorkerEvidenceWorkspaceRecord }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    inactivateWorkerSkillAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  return (
    <form action={action} className="content-stack">
      <input type="hidden" name="recordId" value={record.recordId} />
      <input type="hidden" name="expectedRevision" value={record.currentVersion.revision} />
      <Feedback state={state} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Updating…" : "Mark skill inactive"}
      </Button>
    </form>
  );
}

function LeavingLetterForm({ record }: { record: WorkerEvidenceWorkspaceRecord }): React.JSX.Element {
  const [state, action, pending] = useActionState(
    uploadWorkerLeavingLetterAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  const active = record.leavingLetters.find((letter) => letter.status === "active");
  return (
    <section className="content-stack" aria-label="Leaving letter">
      <div>
        <h4>Leaving letter</h4>
        <p className="muted-copy">
          Attach the leaving letter to this exact ended employment. Replacements preserve the previous letter in history.
        </p>
      </div>
      <Feedback state={state} />
      <form action={action} className="profile-form">
        <input type="hidden" name="recordId" value={record.recordId} />
        <input type="hidden" name="versionId" value={record.currentVersion.versionId} />
        <input type="hidden" name="expectedActiveLeavingLetterId" value={active?.leavingLetterId ?? ""} />
        <Field htmlFor={`leaving-letter-${record.recordId}`} label="Leaving letter file">
          <Input
            id={`leaving-letter-${record.recordId}`}
            name="file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            required
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Uploading…" : active ? "Upload replacement leaving letter" : "Upload leaving letter"}
        </Button>
      </form>
    </section>
  );
}


function PendingCandidateCard({
  candidate
}: {
  candidate: WorkspacePendingCandidate;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    finalizeWorkerEvidenceFileCandidateAction,
    INITIAL_WORKER_EVIDENCE_ACTION_STATE
  );
  const terminalFailure =
    candidate.scanStatus === "unsafe" || candidate.scanStatus === "scan_failed";

  return (
    <div className="content-stack">
      <div>
        <p className="muted-copy">
          {candidate.displayFilename} · {candidate.bindingKind.replaceAll("_", " ")} · {candidate.scanStatus.replaceAll("_", " ")}
        </p>
        <p className="muted-copy">
          This file is not part of accepted evidence until the security scan passes and finalization succeeds.
        </p>
      </div>
      <Feedback state={state} />
      {terminalFailure ? (
        <Alert tone="danger">
          {candidate.scanStatus === "unsafe"
            ? "Security scanning marked this file unsafe. It was not attached; upload a clean replacement."
            : "Security scanning failed. It was not attached; upload the file again after the scanning service is available."}
        </Alert>
      ) : (
        <form action={action} className="content-stack">
          <input type="hidden" name="candidateId" value={candidate.candidateId} />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Checking scan…" : "Check scan status"}
          </Button>
        </form>
      )}
    </div>
  );
}

function PendingScans({
  record
}: {
  record: WorkerEvidenceWorkspaceRecord;
}): React.JSX.Element | null {
  const candidates = record.pendingCandidates.filter(
    (candidate) => candidate.versionId === record.currentVersion.versionId
  );
  if (candidates.length === 0) return null;

  return (
    <section className="content-stack" aria-label={`${record.kind} pending security scans`}>
      <div>
        <h4>Pending security scans</h4>
        <p className="muted-copy">
          Files with a security scan pending or queued remain quarantined and do not replace accepted evidence until the scan passes.
        </p>
      </div>
      {candidates.map((candidate) => (
        <PendingCandidateCard key={candidate.candidateId} candidate={candidate} />
      ))}
    </section>
  );
}

function History({ record }: { record: WorkerEvidenceWorkspaceRecord }): React.JSX.Element {
  return (
    <section className="content-stack" aria-label={`${record.kind} history`}>
      <h4>Version and file history</h4>
      <div className="content-stack">
        {record.versions.map((version) => (
          <p className="muted-copy" key={version.versionId}>
            Version {version.versionNumber} · revision {version.revision} · {version.status.replaceAll("_", " ")}
            {version.submittedAt ? ` · submitted ${formatUtc(version.submittedAt)}` : ""}
          </p>
        ))}
        {record.attachments.map((attachment) => (
          <p className="muted-copy" key={attachment.attachmentId}>
            {attachment.displayFilename} · {attachment.attachmentKind.replaceAll("_", " ")} · {attachment.supersededAt ? "superseded" : "active"}
          </p>
        ))}
        {record.leavingLetters.map((letter) => (
          <p className="muted-copy" key={letter.leavingLetterId}>
            Leaving letter: {letter.displayFilename} · {letter.status}
          </p>
        ))}
      </div>
    </section>
  );
}

function RecordCard({ record }: { record: WorkerEvidenceWorkspaceRecord }): React.JSX.Element {
  const editable = record.currentVersion.status === "draft";
  const submitted = record.currentVersion.status === "submitted";
  const canRevise = submitted && record.lifecycleStatus === "active";

  return (
    <article className="panel page-section content-stack">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{record.kind}</p>
          <h3>{record.kind[0].toUpperCase()}{record.kind.slice(1)} record</h3>
          <p className="muted-copy">
            Version {record.currentVersion.versionNumber} · revision {record.currentVersion.revision} · updated {formatUtc(record.updatedAt)}
          </p>
        </div>
        <span className="status-pill">
          {record.lifecycleStatus} · {record.currentVersion.status}
        </span>
      </div>

      {editable ? (
        <>
          <DraftMetadataForm record={record} />
          <EvidenceFileForm record={record} />
          <SubmitForm record={record} />
        </>
      ) : null}

      {canRevise ? <StartRevisionForm record={record} /> : null}
      {record.kind === "employment" && submitted && record.lifecycleStatus === "active" ? (
        <EndEmploymentForm record={record} />
      ) : null}
      {record.kind === "skill" && submitted && record.lifecycleStatus === "active" ? (
        <InactivateSkillForm record={record} />
      ) : null}
      {record.kind === "employment" && submitted && record.lifecycleStatus === "ended" ? (
        <LeavingLetterForm record={record} />
      ) : null}

      <PendingScans record={record} />
      <History record={record} />
    </article>
  );
}

export function WorkerEvidenceWorkspace({
  records
}: {
  records: readonly WorkerEvidenceWorkspaceRecord[];
}): React.JSX.Element {
  const qualificationCount = records.filter((record) => record.kind === "qualification").length;
  const experienceCount = records.filter((record) => record.kind === "experience").length;
  const employmentCount = records.filter((record) => record.kind === "employment").length;
  const skillCount = records.filter((record) => record.kind === "skill").length;

  return (
    <div className="content-stack">
      <CreateRecordForm />

      <section className="page-section content-stack" aria-labelledby="worker-evidence-records-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Versioned Worker evidence</p>
            <h2 id="worker-evidence-records-heading">Your evidence records</h2>
            <p className="muted-copy">
              Qualification {qualificationCount} · Experience {experienceCount} · Employment {employmentCount} · Skill {skillCount}
            </p>
          </div>
          <span className="status-pill">{records.length}</span>
        </div>
        {records.length ? (
          records.map((record) => <RecordCard key={record.recordId} record={record} />)
        ) : (
          <Alert tone="neutral">
            No evidence records yet. Create a qualification, experience, employment or skill draft above.
          </Alert>
        )}
      </section>
    </div>
  );
}
