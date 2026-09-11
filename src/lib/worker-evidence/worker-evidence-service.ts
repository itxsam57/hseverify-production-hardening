import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import {
  assertDateRange,
  assertWorkerEvidencePrincipal,
  createWorkerEvidenceId,
  normalizeOptionalDate,
  normalizeOptionalMultiline,
  normalizeOptionalText,
  normalizeVerificationUrl,
  WorkerEvidenceContractError,
  WorkerEvidenceNotFoundError,
  type EmploymentDetails,
  type EmploymentDraftInput,
  type ExperienceDetails,
  type ExperienceDraftInput,
  type QualificationDetails,
  type QualificationDraftInput,
  type SkillDetails,
  type WorkerEvidenceRecord,
  type WorkerEvidenceRecordKind,
  type WorkerEvidenceVersion,
  type WorkerSkillDraftInput
} from "./worker-evidence-domain";
import { DatabaseWorkerEvidenceRepository } from "./worker-evidence-repository";

function assertExpectedRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WorkerEvidenceContractError("Worker evidence revision is invalid.");
  }
  return value;
}

function required(value: string | null, label: string): string {
  if (!value) throw new WorkerEvidenceContractError(`${label} is required.`);
  return value;
}

function normalizeQualification(input: QualificationDraftInput): QualificationDetails {
  const issueDate = normalizeOptionalDate(input.issueDate);
  const expiryDate = normalizeOptionalDate(input.expiryDate);
  assertDateRange(issueDate, expiryDate);
  return Object.freeze({
    title: normalizeOptionalText(input.title, 240),
    category: normalizeOptionalText(input.category, 160),
    issuingOrganization: normalizeOptionalText(input.issuingOrganization, 240),
    learningProvider: normalizeOptionalText(input.learningProvider, 240),
    certificateNumber: normalizeOptionalText(input.certificateNumber, 160),
    issueDate,
    expiryDate,
    level: normalizeOptionalText(input.level, 120),
    country: normalizeOptionalText(input.country, 120),
    verificationUrl: normalizeVerificationUrl(input.verificationUrl),
    declarationAccepted: input.declarationAccepted === true
  });
}

function normalizeExperience(input: ExperienceDraftInput): ExperienceDetails {
  const startDate = normalizeOptionalDate(input.startDate);
  const endDate = normalizeOptionalDate(input.endDate);
  assertDateRange(startDate, endDate);
  if (input.status !== "current" && input.status !== "ended") {
    throw new WorkerEvidenceContractError("Experience status is invalid.");
  }
  if (input.status === "current" && endDate !== null) {
    throw new WorkerEvidenceContractError("Current experience cannot have an end date.");
  }
  if (input.status === "ended" && endDate === null) {
    throw new WorkerEvidenceContractError("Ended experience requires an end date.");
  }
  return Object.freeze({
    companyName: normalizeOptionalText(input.companyName, 240),
    roleTitle: normalizeOptionalText(input.roleTitle, 240),
    duties: normalizeOptionalMultiline(input.duties, 4000),
    country: normalizeOptionalText(input.country, 120),
    startDate,
    endDate,
    status: input.status
  });
}

function normalizeEmployment(input: EmploymentDraftInput): EmploymentDetails {
  const startDate = normalizeOptionalDate(input.startDate);
  const endDate = normalizeOptionalDate(input.endDate);
  assertDateRange(startDate, endDate);
  if (input.status !== "current" && input.status !== "ended") {
    throw new WorkerEvidenceContractError("Employment status is invalid.");
  }
  if (input.status === "current" && endDate !== null) {
    throw new WorkerEvidenceContractError("Current employment cannot have an end date.");
  }
  if (input.status === "ended" && endDate === null) {
    throw new WorkerEvidenceContractError("Ended employment requires an end date.");
  }
  return Object.freeze({
    companyName: normalizeOptionalText(input.companyName, 240),
    roleTitle: normalizeOptionalText(input.roleTitle, 240),
    duties: normalizeOptionalMultiline(input.duties, 4000),
    country: normalizeOptionalText(input.country, 120),
    startDate,
    endDate,
    status: input.status,
    endReason: normalizeOptionalMultiline(input.endReason, 1000)
  });
}

function normalizeSkill(input: WorkerSkillDraftInput): SkillDetails {
  if (
    input.experienceMonths !== null &&
    (!Number.isSafeInteger(input.experienceMonths) || input.experienceMonths < 0)
  ) {
    throw new WorkerEvidenceContractError("Skill experience duration is invalid.");
  }
  return Object.freeze({
    skillName: normalizeOptionalText(input.skillName, 240),
    category: normalizeOptionalText(input.category, 160),
    proficiencyClaim: normalizeOptionalText(input.proficiencyClaim, 160),
    experienceMonths: input.experienceMonths,
    relatedTrade: normalizeOptionalText(input.relatedTrade, 160),
    assuranceStatus: "self_declared" as const
  });
}

function validateSubmission(record: WorkerEvidenceRecord): void {
  const details = record.currentVersion.details;
  if (record.kind === "qualification") {
    const qualification = details as QualificationDetails;
    required(qualification.title, "Qualification title");
    required(qualification.category, "Qualification category");
    required(qualification.issuingOrganization, "Issuing organization");
    required(qualification.certificateNumber, "Certificate or candidate number");
    required(qualification.issueDate, "Qualification issue date");
    required(qualification.level, "Qualification level");
    required(qualification.country, "Qualification country");
    if (!qualification.declarationAccepted) {
      throw new WorkerEvidenceContractError("Accept the qualification declaration before submitting.");
    }
    return;
  }
  if (record.kind === "experience") {
    const experience = details as ExperienceDetails;
    required(experience.companyName, "Experience company");
    required(experience.roleTitle, "Experience role");
    required(experience.country, "Experience country");
    required(experience.startDate, "Experience start date");
    return;
  }
  if (record.kind === "employment") {
    const employment = details as EmploymentDetails;
    required(employment.companyName, "Employment company");
    required(employment.roleTitle, "Employment role");
    required(employment.country, "Employment country");
    required(employment.startDate, "Employment start date");
    return;
  }
  const skill = details as SkillDetails;
  required(skill.skillName, "Skill name");
  required(skill.category, "Skill category");
  required(skill.proficiencyClaim, "Skill proficiency claim");
  if (skill.experienceMonths === null) {
    throw new WorkerEvidenceContractError("Skill experience duration is required.");
  }
  if (skill.assuranceStatus !== "self_declared") {
    throw new WorkerEvidenceContractError("Worker skill submissions must remain self-declared.");
  }
}

export class WorkerEvidenceService {
  private readonly repository: DatabaseWorkerEvidenceRepository;

  constructor(
    clientPromise: Promise<DatabaseClient>,
    private readonly now: () => Date = () => new Date()
  ) {
    this.repository = new DatabaseWorkerEvidenceRepository(clientPromise);
  }

  private worker(principal: AuthorizationPrincipal): AuthorizationPrincipal & { activeRole: "worker" } {
    return assertWorkerEvidencePrincipal(principal);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private async currentOrThrow(
    principal: AuthorizationPrincipal,
    recordId: string
  ): Promise<WorkerEvidenceRecord> {
    const worker = this.worker(principal);
    const record = await this.repository.findCurrentForWorker(worker.accountId, recordId.trim());
    if (!record) throw new WorkerEvidenceNotFoundError();
    return record;
  }

  async createDraft(
    principal: AuthorizationPrincipal,
    kind: WorkerEvidenceRecordKind
  ): Promise<WorkerEvidenceRecord> {
    const worker = this.worker(principal);
    if (!(["qualification", "experience", "employment", "skill"] as const).includes(kind)) {
      throw new WorkerEvidenceContractError("Worker evidence kind is invalid.");
    }
    return this.repository.createDraft({
      principal: worker,
      workerAccountId: worker.accountId,
      kind,
      recordId: createWorkerEvidenceId("evidence_record"),
      versionId: createWorkerEvidenceId("evidence_version"),
      now: this.nowIso()
    });
  }

  async findCurrent(
    principal: AuthorizationPrincipal,
    recordId: string
  ): Promise<WorkerEvidenceRecord> {
    return this.currentOrThrow(principal, recordId);
  }

  async listCurrent(
    principal: AuthorizationPrincipal
  ): Promise<readonly WorkerEvidenceRecord[]> {
    const worker = this.worker(principal);
    return this.repository.listCurrentForWorker(worker.accountId);
  }

  async listVersions(
    principal: AuthorizationPrincipal,
    recordId: string
  ): Promise<readonly WorkerEvidenceVersion[]> {
    const current = await this.currentOrThrow(principal, recordId);
    return this.repository.listVersionsForWorker(current.workerAccountId, current.recordId);
  }

  async saveQualificationDraft(
    principal: AuthorizationPrincipal,
    input: QualificationDraftInput
  ): Promise<WorkerEvidenceRecord> {
    const worker = this.worker(principal);
    assertExpectedRevision(input.expectedRevision);
    const saved = await this.repository.saveQualificationDraft(
      worker,
      worker.accountId,
      input,
      normalizeQualification(input),
      this.nowIso()
    );
    if (!saved) throw new WorkerEvidenceNotFoundError();
    return saved;
  }

  async saveExperienceDraft(
    principal: AuthorizationPrincipal,
    input: ExperienceDraftInput
  ): Promise<WorkerEvidenceRecord> {
    const worker = this.worker(principal);
    assertExpectedRevision(input.expectedRevision);
    const saved = await this.repository.saveExperienceDraft(
      worker,
      worker.accountId,
      input,
      normalizeExperience(input),
      this.nowIso()
    );
    if (!saved) throw new WorkerEvidenceNotFoundError();
    return saved;
  }

  async saveEmploymentDraft(
    principal: AuthorizationPrincipal,
    input: EmploymentDraftInput
  ): Promise<WorkerEvidenceRecord> {
    const worker = this.worker(principal);
    assertExpectedRevision(input.expectedRevision);
    const saved = await this.repository.saveEmploymentDraft(
      worker,
      worker.accountId,
      input,
      normalizeEmployment(input),
      this.nowIso()
    );
    if (!saved) throw new WorkerEvidenceNotFoundError();
    return saved;
  }

  async saveSkillDraft(
    principal: AuthorizationPrincipal,
    input: WorkerSkillDraftInput
  ): Promise<WorkerEvidenceRecord> {
    const worker = this.worker(principal);
    assertExpectedRevision(input.expectedRevision);
    const saved = await this.repository.saveSkillDraft(
      worker,
      worker.accountId,
      input,
      normalizeSkill(input),
      this.nowIso()
    );
    if (!saved) throw new WorkerEvidenceNotFoundError();
    return saved;
  }

  async submit(
    principal: AuthorizationPrincipal,
    recordId: string,
    expectedRevision: number
  ): Promise<WorkerEvidenceRecord> {
    const current = await this.currentOrThrow(principal, recordId);
    assertExpectedRevision(expectedRevision);
    if (current.currentVersion.status !== "draft" || current.currentVersion.revision !== expectedRevision) {
      const { WorkerEvidenceConflictError } = await import("./worker-evidence-domain");
      throw new WorkerEvidenceConflictError();
    }
    validateSubmission(current);
    const submitted = await this.repository.submitDraft({
      principal: this.worker(principal),
      workerAccountId: current.workerAccountId,
      recordId: current.recordId,
      expectedRevision,
      now: this.nowIso()
    });
    if (!submitted) throw new WorkerEvidenceNotFoundError();
    return submitted;
  }

  async startRevision(
    principal: AuthorizationPrincipal,
    recordId: string,
    expectedRevision: number
  ): Promise<WorkerEvidenceRecord> {
    const current = await this.currentOrThrow(principal, recordId);
    assertExpectedRevision(expectedRevision);
    const revised = await this.repository.startRevision({
      principal: this.worker(principal),
      workerAccountId: current.workerAccountId,
      recordId: current.recordId,
      expectedRevision,
      newVersionId: createWorkerEvidenceId("evidence_version"),
      now: this.nowIso()
    });
    if (!revised) throw new WorkerEvidenceNotFoundError();
    return revised;
  }

  async endEmployment(
    principal: AuthorizationPrincipal,
    recordId: string,
    expectedRevision: number,
    endDateInput: string,
    endReasonInput: string | null = null
  ): Promise<WorkerEvidenceRecord> {
    const current = await this.currentOrThrow(principal, recordId);
    if (current.kind !== "employment") throw new WorkerEvidenceNotFoundError();
    assertExpectedRevision(expectedRevision);
    const endDate = normalizeOptionalDate(endDateInput);
    if (!endDate) throw new WorkerEvidenceContractError("Employment end date is required.");
    const employment = current.currentVersion.details as EmploymentDetails;
    assertDateRange(employment.startDate, endDate);
    const ended = await this.repository.endEmployment({
      principal: this.worker(principal),
      workerAccountId: current.workerAccountId,
      recordId: current.recordId,
      expectedRevision,
      newVersionId: createWorkerEvidenceId("evidence_version"),
      endDate,
      endReason: normalizeOptionalMultiline(endReasonInput, 1000),
      now: this.nowIso()
    });
    if (!ended) throw new WorkerEvidenceNotFoundError();
    return ended;
  }

  async markSkillInactive(
    principal: AuthorizationPrincipal,
    recordId: string,
    expectedRevision: number
  ): Promise<WorkerEvidenceRecord> {
    const current = await this.currentOrThrow(principal, recordId);
    if (current.kind !== "skill") throw new WorkerEvidenceNotFoundError();
    assertExpectedRevision(expectedRevision);
    const inactive = await this.repository.markSkillInactive({
      principal: this.worker(principal),
      workerAccountId: current.workerAccountId,
      recordId: current.recordId,
      expectedRevision,
      newVersionId: createWorkerEvidenceId("evidence_version"),
      now: this.nowIso()
    });
    if (!inactive) throw new WorkerEvidenceNotFoundError();
    return inactive;
  }
}
