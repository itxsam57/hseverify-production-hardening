import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor, type AuditAction } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import {
  WorkerEvidenceAttachmentUnavailableError,
  WorkerEvidenceConflictError,
  type EmploymentDetails,
  type EmploymentDraftInput,
  type ExperienceDetails,
  type ExperienceDraftInput,
  type QualificationDetails,
  type QualificationDraftInput,
  type SkillDetails,
  type WorkerEvidenceDetails,
  type WorkerEvidenceLifecycleStatus,
  type WorkerEvidenceRecord,
  type WorkerEvidenceRecordKind,
  type WorkerEvidenceVersion,
  type WorkerEvidenceVersionStatus,
  type WorkerSkillDraftInput
} from "./worker-evidence-domain";

type EvidenceRow = {
  record_id: string;
  worker_account_id: string;
  record_kind: WorkerEvidenceRecordKind;
  lifecycle_status: WorkerEvidenceLifecycleStatus;
  record_created_at: string | Date;
  record_updated_at: string | Date;
  version_id: string;
  version_number: number;
  revision: number;
  version_status: WorkerEvidenceVersionStatus;
  supersedes_version_id: string | null;
  version_created_at: string | Date;
  version_updated_at: string | Date;
  submitted_at: string | Date | null;
  qualification_title: string | null;
  qualification_category: string | null;
  issuing_organization: string | null;
  learning_provider: string | null;
  certificate_number: string | null;
  issue_date: string | Date | null;
  expiry_date: string | Date | null;
  qualification_level: string | null;
  qualification_country: string | null;
  verification_url: string | null;
  declaration_accepted: boolean | null;
  experience_company_name: string | null;
  experience_role_title: string | null;
  experience_duties: string | null;
  experience_country: string | null;
  experience_start_date: string | Date | null;
  experience_end_date: string | Date | null;
  experience_status: "current" | "ended" | null;
  employment_company_name: string | null;
  employment_role_title: string | null;
  employment_duties: string | null;
  employment_country: string | null;
  employment_start_date: string | Date | null;
  employment_end_date: string | Date | null;
  employment_status: "current" | "ended" | null;
  end_reason: string | null;
  skill_name: string | null;
  skill_category: string | null;
  proficiency_claim: string | null;
  experience_months: number | null;
  related_trade: string | null;
  skill_assurance_status: "self_declared" | "evidence_verified" | "competency_assessed" | null;
};

const EVIDENCE_PROJECTION = `
SELECT records.record_id,
       records.worker_account_id,
       records.record_kind,
       records.lifecycle_status,
       records.created_at AS record_created_at,
       records.updated_at AS record_updated_at,
       versions.version_id,
       versions.version_number,
       versions.revision,
       versions.version_status,
       versions.supersedes_version_id,
       versions.created_at AS version_created_at,
       versions.updated_at AS version_updated_at,
       versions.submitted_at,
       qualifications.qualification_title,
       qualifications.category AS qualification_category,
       qualifications.issuing_organization,
       qualifications.learning_provider,
       qualifications.certificate_number,
       qualifications.issue_date,
       qualifications.expiry_date,
       qualifications.qualification_level,
       qualifications.country AS qualification_country,
       qualifications.verification_url,
       qualifications.declaration_accepted,
       experiences.company_name AS experience_company_name,
       experiences.role_title AS experience_role_title,
       experiences.duties AS experience_duties,
       experiences.country AS experience_country,
       experiences.start_date AS experience_start_date,
       experiences.end_date AS experience_end_date,
       experiences.experience_status,
       employments.company_name AS employment_company_name,
       employments.role_title AS employment_role_title,
       employments.duties AS employment_duties,
       employments.country AS employment_country,
       employments.start_date AS employment_start_date,
       employments.end_date AS employment_end_date,
       employments.employment_status,
       employments.end_reason,
       skills.skill_name,
       skills.category AS skill_category,
       skills.proficiency_claim,
       skills.experience_months,
       skills.related_trade,
       skills.skill_assurance_status
  FROM worker_evidence_records AS records
  JOIN worker_evidence_versions AS versions
    ON versions.record_id=records.record_id
  LEFT JOIN worker_qualification_versions AS qualifications
    ON qualifications.version_id=versions.version_id
  LEFT JOIN worker_experience_versions AS experiences
    ON experiences.version_id=versions.version_id
  LEFT JOIN worker_employment_versions AS employments
    ON employments.version_id=versions.version_id
  LEFT JOIN worker_skill_versions AS skills
    ON skills.version_id=versions.version_id`;

async function appendWorkerEvidenceAudit(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  action: AuditAction,
  recordId: string,
  metadata: unknown,
  _occurredAt: string
): Promise<void> {
  const audit = new DatabaseAuditRepository(Promise.resolve(database));
  const actor = bindTrustedAuditActor(principal);
  await audit.append(actor, {
    action,
    outcome: "succeeded",
    target: Object.freeze({ type: "resource", reference: recordId }),

    metadata,

  });
}

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function calendarDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function detailsFromRow(row: EvidenceRow): WorkerEvidenceDetails {
  if (row.record_kind === "qualification") {
    return Object.freeze<QualificationDetails>({
      title: row.qualification_title,
      category: row.qualification_category,
      issuingOrganization: row.issuing_organization,
      learningProvider: row.learning_provider,
      certificateNumber: row.certificate_number,
      issueDate: calendarDate(row.issue_date),
      expiryDate: calendarDate(row.expiry_date),
      level: row.qualification_level,
      country: row.qualification_country,
      verificationUrl: row.verification_url,
      declarationAccepted: row.declaration_accepted === true
    });
  }
  if (row.record_kind === "experience") {
    return Object.freeze<ExperienceDetails>({
      companyName: row.experience_company_name,
      roleTitle: row.experience_role_title,
      duties: row.experience_duties,
      country: row.experience_country,
      startDate: calendarDate(row.experience_start_date),
      endDate: calendarDate(row.experience_end_date),
      status: row.experience_status ?? "current"
    });
  }
  if (row.record_kind === "employment") {
    return Object.freeze<EmploymentDetails>({
      companyName: row.employment_company_name,
      roleTitle: row.employment_role_title,
      duties: row.employment_duties,
      country: row.employment_country,
      startDate: calendarDate(row.employment_start_date),
      endDate: calendarDate(row.employment_end_date),
      status: row.employment_status ?? "current",
      endReason: row.end_reason
    });
  }
  return Object.freeze<SkillDetails>({
    skillName: row.skill_name,
    category: row.skill_category,
    proficiencyClaim: row.proficiency_claim,
    experienceMonths: row.experience_months,
    relatedTrade: row.related_trade,
    assuranceStatus: row.skill_assurance_status ?? "self_declared"
  });
}

function versionFromRow(row: EvidenceRow): WorkerEvidenceVersion {
  return Object.freeze({
    versionId: row.version_id,
    versionNumber: Number(row.version_number),
    revision: Number(row.revision),
    status: row.version_status,
    supersedesVersionId: row.supersedes_version_id,
    createdAt: timestamp(row.version_created_at),
    updatedAt: timestamp(row.version_updated_at),
    submittedAt: nullableTimestamp(row.submitted_at),
    details: detailsFromRow(row)
  });
}

function recordFromRow(row: EvidenceRow): WorkerEvidenceRecord {
  return Object.freeze({
    recordId: row.record_id,
    workerAccountId: row.worker_account_id,
    kind: row.record_kind,
    lifecycleStatus: row.lifecycle_status,
    createdAt: timestamp(row.record_created_at),
    updatedAt: timestamp(row.record_updated_at),
    currentVersion: versionFromRow(row)
  });
}

async function insertEmptyDetails(
  database: DatabaseClient,
  kind: WorkerEvidenceRecordKind,
  versionId: string
): Promise<void> {
  if (kind === "qualification") {
    await database.query(
      `INSERT INTO worker_qualification_versions (version_id, declaration_accepted)
       VALUES ($1,false)`,
      [versionId]
    );
  } else if (kind === "experience") {
    await database.query(
      `INSERT INTO worker_experience_versions (version_id, experience_status)
       VALUES ($1,'current')`,
      [versionId]
    );
  } else if (kind === "employment") {
    await database.query(
      `INSERT INTO worker_employment_versions (version_id, employment_status)
       VALUES ($1,'current')`,
      [versionId]
    );
  } else {
    await database.query(
      `INSERT INTO worker_skill_versions (version_id, skill_assurance_status)
       VALUES ($1,'self_declared')`,
      [versionId]
    );
  }
}

export class DatabaseWorkerEvidenceRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient>) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async createDraft(input: {
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    kind: WorkerEvidenceRecordKind;
    recordId: string;
    versionId: string;
    now: string;
  }): Promise<WorkerEvidenceRecord> {
    const database = await this.client();
    await database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO worker_evidence_records (
           record_id, worker_account_id, record_kind, lifecycle_status,
           current_version_id, created_at, updated_at
         ) VALUES ($1,$2,$3,'active',NULL,$4,$4)`,
        [input.recordId, input.workerAccountId, input.kind, input.now]
      );
      await transaction.query(
        `INSERT INTO worker_evidence_versions (
           version_id, record_id, version_number, revision, version_status,
           supersedes_version_id, created_at, updated_at, submitted_at
         ) VALUES ($1,$2,1,1,'draft',NULL,$3,$3,NULL)`,
        [input.versionId, input.recordId, input.now]
      );
      await insertEmptyDetails(transaction, input.kind, input.versionId);
      await transaction.query(
        `UPDATE worker_evidence_records
            SET current_version_id=$2, updated_at=$3
          WHERE record_id=$1 AND worker_account_id=$4`,
        [input.recordId, input.versionId, input.now, input.workerAccountId]
      );
      await appendWorkerEvidenceAudit(
        transaction,
        input.principal,
        "worker_evidence.record.created",
        input.recordId,
        Object.freeze({ recordKind: input.kind, versionId: input.versionId }),
        input.now
      );
    });
    const created = await this.findCurrentForWorker(input.workerAccountId, input.recordId);
    if (!created) throw new Error("Worker evidence draft was not persisted.");
    return created;
  }

  async findCurrentForWorker(
    workerAccountId: string,
    recordId: string
  ): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const result = await database.query<EvidenceRow>(
      `${EVIDENCE_PROJECTION}
       WHERE records.worker_account_id=$1
         AND records.record_id=$2
         AND versions.version_id=records.current_version_id`,
      [workerAccountId, recordId]
    );
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }

  async listCurrentForWorker(workerAccountId: string): Promise<readonly WorkerEvidenceRecord[]> {
    const database = await this.client();
    const result = await database.query<EvidenceRow>(
      `${EVIDENCE_PROJECTION}
       WHERE records.worker_account_id=$1
         AND versions.version_id=records.current_version_id
       ORDER BY records.updated_at DESC, records.record_id`,
      [workerAccountId]
    );
    return Object.freeze(result.rows.map(recordFromRow));
  }

  async listVersionsForWorker(
    workerAccountId: string,
    recordId: string
  ): Promise<readonly WorkerEvidenceVersion[]> {
    const database = await this.client();
    const result = await database.query<EvidenceRow>(
      `${EVIDENCE_PROJECTION}
       WHERE records.worker_account_id=$1
         AND records.record_id=$2
       ORDER BY versions.version_number`,
      [workerAccountId, recordId]
    );
    return Object.freeze(result.rows.map(versionFromRow));
  }

  private async lockCurrent(
    database: DatabaseClient,
    workerAccountId: string,
    recordId: string,
    expectedKind?: WorkerEvidenceRecordKind
  ): Promise<{
    kind: WorkerEvidenceRecordKind;
    lifecycleStatus: WorkerEvidenceLifecycleStatus;
    versionId: string;
    versionNumber: number;
    revision: number;
    status: WorkerEvidenceVersionStatus;
    supersedesVersionId: string | null;
  } | null> {
    const result = await database.query<{
      record_kind: WorkerEvidenceRecordKind;
      lifecycle_status: WorkerEvidenceLifecycleStatus;
      version_id: string;
      version_number: number;
      revision: number;
      version_status: WorkerEvidenceVersionStatus;
      supersedes_version_id: string | null;
    }>(
      `SELECT records.record_kind, records.lifecycle_status,
              versions.version_id, versions.version_number, versions.revision,
              versions.version_status, versions.supersedes_version_id
         FROM worker_evidence_records AS records
         JOIN worker_evidence_versions AS versions
           ON versions.version_id=records.current_version_id
        WHERE records.worker_account_id=$1
          AND records.record_id=$2
          AND ($3::text IS NULL OR records.record_kind=$3)
        FOR UPDATE OF records, versions`,
      [workerAccountId, recordId, expectedKind ?? null]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      kind: row.record_kind,
      lifecycleStatus: row.lifecycle_status,
      versionId: row.version_id,
      versionNumber: Number(row.version_number),
      revision: Number(row.revision),
      status: row.version_status,
      supersedesVersionId: row.supersedes_version_id
    };
  }

  private async finishDraftSave(
    database: DatabaseClient,
    input: {
      workerAccountId: string;
      recordId: string;
      versionId: string;
      expectedRevision: number;
      now: string;
    }
  ): Promise<void> {
    const updated = await database.query(
      `UPDATE worker_evidence_versions
          SET revision=revision+1, updated_at=$4
        WHERE version_id=$1
          AND record_id=$2
          AND revision=$3
          AND version_status='draft'`,
      [input.versionId, input.recordId, input.expectedRevision, input.now]
    );
    if (updated.affectedRows !== 1) throw new WorkerEvidenceConflictError();
    await database.query(
      `UPDATE worker_evidence_records
          SET updated_at=$3
        WHERE record_id=$1 AND worker_account_id=$2`,
      [input.recordId, input.workerAccountId, input.now]
    );
  }

  async saveQualificationDraft(
    principal: AuthorizationPrincipal,
    workerAccountId: string,
    input: QualificationDraftInput,
    details: QualificationDetails,
    now: string
  ): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const found = await database.transaction(async (transaction) => {
      const current = await this.lockCurrent(transaction, workerAccountId, input.recordId, "qualification");
      if (!current) return false;
      if (current.status !== "draft" || current.revision !== input.expectedRevision) {
        throw new WorkerEvidenceConflictError();
      }
      await transaction.query(
        `UPDATE worker_qualification_versions
            SET qualification_title=$2, category=$3, issuing_organization=$4,
                learning_provider=$5, certificate_number=$6, issue_date=$7::date,
                expiry_date=$8::date, qualification_level=$9, country=$10,
                verification_url=$11, declaration_accepted=$12
          WHERE version_id=$1`,
        [
          current.versionId,
          details.title,
          details.category,
          details.issuingOrganization,
          details.learningProvider,
          details.certificateNumber,
          details.issueDate,
          details.expiryDate,
          details.level,
          details.country,
          details.verificationUrl,
          details.declarationAccepted
        ]
      );
      await this.finishDraftSave(transaction, {
        workerAccountId,
        recordId: input.recordId,
        versionId: current.versionId,
        expectedRevision: input.expectedRevision,
        now
      });
      await appendWorkerEvidenceAudit(
        transaction,
        principal,
        "worker_evidence.draft.saved",
        input.recordId,
        Object.freeze({ recordKind: "qualification", versionId: current.versionId }),
        now
      );
      return true;
    });
    return found ? this.findCurrentForWorker(workerAccountId, input.recordId) : null;
  }

  async saveExperienceDraft(
    principal: AuthorizationPrincipal,
    workerAccountId: string,
    input: ExperienceDraftInput,
    details: ExperienceDetails,
    now: string
  ): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const found = await database.transaction(async (transaction) => {
      const current = await this.lockCurrent(transaction, workerAccountId, input.recordId, "experience");
      if (!current) return false;
      if (current.status !== "draft" || current.revision !== input.expectedRevision) {
        throw new WorkerEvidenceConflictError();
      }
      await transaction.query(
        `UPDATE worker_experience_versions
            SET company_name=$2, role_title=$3, duties=$4, country=$5,
                start_date=$6::date, end_date=$7::date, experience_status=$8
          WHERE version_id=$1`,
        [
          current.versionId,
          details.companyName,
          details.roleTitle,
          details.duties,
          details.country,
          details.startDate,
          details.endDate,
          details.status
        ]
      );
      await this.finishDraftSave(transaction, {
        workerAccountId,
        recordId: input.recordId,
        versionId: current.versionId,
        expectedRevision: input.expectedRevision,
        now
      });
      await appendWorkerEvidenceAudit(
        transaction,
        principal,
        "worker_evidence.draft.saved",
        input.recordId,
        Object.freeze({ recordKind: "experience", versionId: current.versionId }),
        now
      );
      return true;
    });
    return found ? this.findCurrentForWorker(workerAccountId, input.recordId) : null;
  }

  async saveEmploymentDraft(
    principal: AuthorizationPrincipal,
    workerAccountId: string,
    input: EmploymentDraftInput,
    details: EmploymentDetails,
    now: string
  ): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const found = await database.transaction(async (transaction) => {
      const current = await this.lockCurrent(transaction, workerAccountId, input.recordId, "employment");
      if (!current) return false;
      if (current.status !== "draft" || current.revision !== input.expectedRevision) {
        throw new WorkerEvidenceConflictError();
      }
      await transaction.query(
        `UPDATE worker_employment_versions
            SET company_name=$2, role_title=$3, duties=$4, country=$5,
                start_date=$6::date, end_date=$7::date,
                employment_status=$8, end_reason=$9
          WHERE version_id=$1`,
        [
          current.versionId,
          details.companyName,
          details.roleTitle,
          details.duties,
          details.country,
          details.startDate,
          details.endDate,
          details.status,
          details.endReason
        ]
      );
      await this.finishDraftSave(transaction, {
        workerAccountId,
        recordId: input.recordId,
        versionId: current.versionId,
        expectedRevision: input.expectedRevision,
        now
      });
      await appendWorkerEvidenceAudit(
        transaction,
        principal,
        "worker_evidence.draft.saved",
        input.recordId,
        Object.freeze({ recordKind: "employment", versionId: current.versionId }),
        now
      );
      return true;
    });
    return found ? this.findCurrentForWorker(workerAccountId, input.recordId) : null;
  }

  async saveSkillDraft(
    principal: AuthorizationPrincipal,
    workerAccountId: string,
    input: WorkerSkillDraftInput,
    details: SkillDetails,
    now: string
  ): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const found = await database.transaction(async (transaction) => {
      const current = await this.lockCurrent(transaction, workerAccountId, input.recordId, "skill");
      if (!current) return false;
      if (current.status !== "draft" || current.revision !== input.expectedRevision) {
        throw new WorkerEvidenceConflictError();
      }
      await transaction.query(
        `UPDATE worker_skill_versions
            SET skill_name=$2, category=$3, proficiency_claim=$4,
                experience_months=$5, related_trade=$6,
                skill_assurance_status='self_declared'
          WHERE version_id=$1`,
        [
          current.versionId,
          details.skillName,
          details.category,
          details.proficiencyClaim,
          details.experienceMonths,
          details.relatedTrade
        ]
      );
      await this.finishDraftSave(transaction, {
        workerAccountId,
        recordId: input.recordId,
        versionId: current.versionId,
        expectedRevision: input.expectedRevision,
        now
      });
      await appendWorkerEvidenceAudit(
        transaction,
        principal,
        "worker_evidence.draft.saved",
        input.recordId,
        Object.freeze({ recordKind: "skill", versionId: current.versionId }),
        now
      );
      return true;
    });
    return found ? this.findCurrentForWorker(workerAccountId, input.recordId) : null;
  }

  async submitDraft(input: {
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    recordId: string;
    expectedRevision: number;
    now: string;
  }): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const found = await database.transaction(async (transaction) => {
      const current = await this.lockCurrent(transaction, input.workerAccountId, input.recordId);
      if (!current) return false;
      if (current.status !== "draft" || current.revision !== input.expectedRevision) {
        throw new WorkerEvidenceConflictError();
      }
      if (current.kind === "qualification") {
        const primaryCertificate = await transaction.query(
          `SELECT 1
             FROM worker_evidence_attachments
            WHERE record_id=$1
              AND version_id=$2
              AND attachment_kind='primary_certificate'
              AND superseded_at IS NULL
            LIMIT 1`,
          [input.recordId, current.versionId]
        );
        if (primaryCertificate.rows.length !== 1) {
          throw new WorkerEvidenceAttachmentUnavailableError(
            "Attach the primary qualification certificate before submitting."
          );
        }
      }
      if (current.supersedesVersionId) {
        await transaction.query(
          `UPDATE worker_evidence_versions
              SET version_status='superseded', updated_at=$2
            WHERE version_id=$1 AND version_status='submitted'`,
          [current.supersedesVersionId, input.now]
        );
      }
      const updated = await transaction.query(
        `UPDATE worker_evidence_versions
            SET version_status='submitted', submitted_at=$4,
                updated_at=$4, revision=revision+1
          WHERE version_id=$1 AND record_id=$2
            AND revision=$3 AND version_status='draft'`,
        [current.versionId, input.recordId, input.expectedRevision, input.now]
      );
      if (updated.affectedRows !== 1) throw new WorkerEvidenceConflictError();
      await transaction.query(
        `UPDATE worker_evidence_records SET updated_at=$3
          WHERE record_id=$1 AND worker_account_id=$2`,
        [input.recordId, input.workerAccountId, input.now]
      );
      await appendWorkerEvidenceAudit(
        transaction,
        input.principal,
        "worker_evidence.version.submitted",
        input.recordId,
        Object.freeze({ versionId: current.versionId, versionNumber: current.versionNumber }),
        input.now
      );
      return true;
    });
    return found ? this.findCurrentForWorker(input.workerAccountId, input.recordId) : null;
  }

  async startRevision(input: {
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    recordId: string;
    expectedRevision: number;
    newVersionId: string;
    now: string;
  }): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const found = await database.transaction(async (transaction) => {
      const current = await this.lockCurrent(transaction, input.workerAccountId, input.recordId);
      if (!current) return false;
      if (
        current.lifecycleStatus !== "active" ||
        current.status !== "submitted" ||
        current.revision !== input.expectedRevision
      ) {
        throw new WorkerEvidenceConflictError();
      }
      await transaction.query(
        `INSERT INTO worker_evidence_versions (
           version_id, record_id, version_number, revision, version_status,
           supersedes_version_id, created_at, updated_at, submitted_at
         ) VALUES ($1,$2,$3,1,'draft',$4,$5,$5,NULL)`,
        [
          input.newVersionId,
          input.recordId,
          current.versionNumber + 1,
          current.versionId,
          input.now
        ]
      );
      if (current.kind === "qualification") {
        await transaction.query(
          `INSERT INTO worker_qualification_versions
           SELECT $2, qualification_title, category, issuing_organization,
                  learning_provider, certificate_number, issue_date, expiry_date,
                  qualification_level, country, verification_url, declaration_accepted
             FROM worker_qualification_versions WHERE version_id=$1`,
          [current.versionId, input.newVersionId]
        );
      } else if (current.kind === "experience") {
        await transaction.query(
          `INSERT INTO worker_experience_versions
           SELECT $2, company_name, role_title, duties, country,
                  start_date, end_date, experience_status
             FROM worker_experience_versions WHERE version_id=$1`,
          [current.versionId, input.newVersionId]
        );
      } else if (current.kind === "employment") {
        await transaction.query(
          `INSERT INTO worker_employment_versions
           SELECT $2, company_name, role_title, duties, country,
                  start_date, end_date, employment_status, end_reason
             FROM worker_employment_versions WHERE version_id=$1`,
          [current.versionId, input.newVersionId]
        );
      } else {
        await transaction.query(
          `INSERT INTO worker_skill_versions
           SELECT $2, skill_name, category, proficiency_claim, experience_months,
                  related_trade, skill_assurance_status
             FROM worker_skill_versions WHERE version_id=$1`,
          [current.versionId, input.newVersionId]
        );
      }
      await transaction.query(
        `UPDATE worker_evidence_records
            SET current_version_id=$3, updated_at=$4
          WHERE record_id=$1 AND worker_account_id=$2`,
        [input.recordId, input.workerAccountId, input.newVersionId, input.now]
      );
      await appendWorkerEvidenceAudit(
        transaction,
        input.principal,
        "worker_evidence.revision.started",
        input.recordId,
        Object.freeze({ previousVersionId: current.versionId, newVersionId: input.newVersionId }),
        input.now
      );
      return true;
    });
    return found ? this.findCurrentForWorker(input.workerAccountId, input.recordId) : null;
  }

  async endEmployment(input: {
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    recordId: string;
    expectedRevision: number;
    newVersionId: string;
    endDate: string;
    endReason: string | null;
    now: string;
  }): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const found = await database.transaction(async (transaction) => {
      const current = await this.lockCurrent(transaction, input.workerAccountId, input.recordId, "employment");
      if (!current) return false;
      if (
        current.lifecycleStatus !== "active" ||
        current.status !== "submitted" ||
        current.revision !== input.expectedRevision
      ) {
        throw new WorkerEvidenceConflictError();
      }
      await transaction.query(
        `UPDATE worker_evidence_versions
            SET version_status='superseded', updated_at=$2
          WHERE version_id=$1 AND version_status='submitted'`,
        [current.versionId, input.now]
      );
      await transaction.query(
        `INSERT INTO worker_evidence_versions (
           version_id, record_id, version_number, revision, version_status,
           supersedes_version_id, created_at, updated_at, submitted_at
         ) VALUES ($1,$2,$3,1,'submitted',$4,$5,$5,$5)`,
        [input.newVersionId, input.recordId, current.versionNumber + 1, current.versionId, input.now]
      );
      await transaction.query(
        `INSERT INTO worker_employment_versions (
           version_id, company_name, role_title, duties, country,
           start_date, end_date, employment_status, end_reason
         )
         SELECT $2, company_name, role_title, duties, country,
                start_date, $3::date, 'ended', $4
           FROM worker_employment_versions WHERE version_id=$1`,
        [current.versionId, input.newVersionId, input.endDate, input.endReason]
      );
      await transaction.query(
        `UPDATE worker_evidence_records
            SET current_version_id=$3, lifecycle_status='ended', updated_at=$4
          WHERE record_id=$1 AND worker_account_id=$2`,
        [input.recordId, input.workerAccountId, input.newVersionId, input.now]
      );
      await appendWorkerEvidenceAudit(
        transaction,
        input.principal,
        "worker_evidence.employment.ended",
        input.recordId,
        Object.freeze({ previousVersionId: current.versionId, newVersionId: input.newVersionId }),
        input.now
      );
      return true;
    });
    return found ? this.findCurrentForWorker(input.workerAccountId, input.recordId) : null;
  }

  async markSkillInactive(input: {
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    recordId: string;
    expectedRevision: number;
    newVersionId: string;
    now: string;
  }): Promise<WorkerEvidenceRecord | null> {
    const database = await this.client();
    const found = await database.transaction(async (transaction) => {
      const current = await this.lockCurrent(transaction, input.workerAccountId, input.recordId, "skill");
      if (!current) return false;
      if (
        current.lifecycleStatus !== "active" ||
        current.status !== "submitted" ||
        current.revision !== input.expectedRevision
      ) {
        throw new WorkerEvidenceConflictError();
      }
      await transaction.query(
        `UPDATE worker_evidence_versions
            SET version_status='superseded', updated_at=$2
          WHERE version_id=$1 AND version_status='submitted'`,
        [current.versionId, input.now]
      );
      await transaction.query(
        `INSERT INTO worker_evidence_versions (
           version_id, record_id, version_number, revision, version_status,
           supersedes_version_id, created_at, updated_at, submitted_at
         ) VALUES ($1,$2,$3,1,'submitted',$4,$5,$5,$5)`,
        [input.newVersionId, input.recordId, current.versionNumber + 1, current.versionId, input.now]
      );
      await transaction.query(
        `INSERT INTO worker_skill_versions
         SELECT $2, skill_name, category, proficiency_claim, experience_months,
                related_trade, skill_assurance_status
           FROM worker_skill_versions WHERE version_id=$1`,
        [current.versionId, input.newVersionId]
      );
      await transaction.query(
        `UPDATE worker_evidence_records
            SET current_version_id=$3, lifecycle_status='inactive', updated_at=$4
          WHERE record_id=$1 AND worker_account_id=$2`,
        [input.recordId, input.workerAccountId, input.newVersionId, input.now]
      );
      await appendWorkerEvidenceAudit(
        transaction,
        input.principal,
        "worker_evidence.skill.inactivated",
        input.recordId,
        Object.freeze({ previousVersionId: current.versionId, newVersionId: input.newVersionId }),
        input.now
      );
      return true;
    });
    return found ? this.findCurrentForWorker(input.workerAccountId, input.recordId) : null;
  }

  async bindAttachment(input: {
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    recordId: string;
    versionId: string;
    attachmentKind:
      | "primary_certificate"
      | "supporting_evidence"
      | "experience_evidence"
      | "employment_evidence"
      | "skill_evidence";
    expectedActiveAttachmentId: string | null;
    attachmentId: string;
    secureFileId: string;
    displayFilename: string;
    now: string;
  }): Promise<Readonly<{
    attachmentId: string;
    recordId: string;
    versionId: string;
    attachmentKind: string;
    secureFileId: string;
    displayFilename: string;
    createdAt: string;
    supersededAt: string | null;
  }> | null> {
    const database = await this.client();
    const created = await database.transaction(async (transaction) => {
      const current = await transaction.query<{
        version_status: WorkerEvidenceVersionStatus;
      }>(
        `SELECT versions.version_status
           FROM worker_evidence_records AS records
           JOIN worker_evidence_versions AS versions
             ON versions.version_id=records.current_version_id
          WHERE records.worker_account_id=$1
            AND records.record_id=$2
            AND versions.version_id=$3
          FOR UPDATE OF records, versions`,
        [input.workerAccountId, input.recordId, input.versionId]
      );
      const row = current.rows[0];
      if (!row) return null;
      if (row.version_status !== "draft") {
        throw new WorkerEvidenceConflictError(
          "Evidence files can only be changed on the current draft version."
        );
      }

      const active = await transaction.query<{
        attachment_id: string;
      }>(
        `SELECT attachment_id
           FROM worker_evidence_attachments
          WHERE record_id=$1
            AND version_id=$2
            AND attachment_kind=$3
            AND superseded_at IS NULL
          ORDER BY created_at DESC, attachment_id
          FOR UPDATE`,
        [input.recordId, input.versionId, input.attachmentKind]
      );

      if (input.expectedActiveAttachmentId) {
        if (
          !active.rows.some(
            (attachment) =>
              attachment.attachment_id === input.expectedActiveAttachmentId
          )
        ) {
          throw new WorkerEvidenceConflictError(
            "The evidence file changed in another session. Refresh and try again."
          );
        }
        const superseded = await transaction.query(
          `UPDATE worker_evidence_attachments
              SET superseded_at=$2
            WHERE attachment_id=$1
              AND record_id=$3
              AND version_id=$4
              AND attachment_kind=$5
              AND superseded_at IS NULL`,
          [
            input.expectedActiveAttachmentId,
            input.now,
            input.recordId,
            input.versionId,
            input.attachmentKind
          ]
        );
        if (superseded.affectedRows !== 1) {
          throw new WorkerEvidenceConflictError(
            "The evidence file changed in another session. Refresh and try again."
          );
        }
      } else if (
        input.attachmentKind === "primary_certificate" &&
        active.rows.length > 0
      ) {
        throw new WorkerEvidenceConflictError(
          "A primary certificate is already attached. Refresh before replacing it."
        );
      }

      await transaction.query(
        `INSERT INTO worker_evidence_attachments (
           attachment_id, record_id, version_id, attachment_kind,
           secure_file_id, display_filename, created_at, superseded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)`,
        [
          input.attachmentId,
          input.recordId,
          input.versionId,
          input.attachmentKind,
          input.secureFileId,
          input.displayFilename,
          input.now
        ]
      );
      await appendWorkerEvidenceAudit(
        transaction,
        input.principal,
        input.expectedActiveAttachmentId
          ? "worker_evidence.file.replaced"
          : "worker_evidence.file.attached",
        input.recordId,
        Object.freeze({
          versionId: input.versionId,
          attachmentId: input.attachmentId,
          attachmentKind: input.attachmentKind
        }),
        input.now
      );
      return Object.freeze({
        attachmentId: input.attachmentId,
        recordId: input.recordId,
        versionId: input.versionId,
        attachmentKind: input.attachmentKind,
        secureFileId: input.secureFileId,
        displayFilename: input.displayFilename,
        createdAt: input.now,
        supersededAt: null
      });
    });
    return created;
  }

  async listAttachmentsForWorker(
    workerAccountId: string,
    recordId: string
  ): Promise<readonly Readonly<{
    attachmentId: string;
    recordId: string;
    versionId: string;
    attachmentKind: string;
    secureFileId: string;
    displayFilename: string;
    createdAt: string;
    supersededAt: string | null;
  }>[]> {
    const database = await this.client();
    const result = await database.query<{
      attachment_id: string;
      record_id: string;
      version_id: string;
      attachment_kind: string;
      secure_file_id: string;
      display_filename: string;
      created_at: string | Date;
      superseded_at: string | Date | null;
    }>(
      `SELECT attachments.attachment_id,
              attachments.record_id,
              attachments.version_id,
              attachments.attachment_kind,
              attachments.secure_file_id,
              attachments.display_filename,
              attachments.created_at,
              attachments.superseded_at
         FROM worker_evidence_attachments AS attachments
         JOIN worker_evidence_records AS records
           ON records.record_id=attachments.record_id
        WHERE records.worker_account_id=$1
          AND records.record_id=$2
        ORDER BY attachments.created_at, attachments.attachment_id`,
      [workerAccountId, recordId]
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          attachmentId: row.attachment_id,
          recordId: row.record_id,
          versionId: row.version_id,
          attachmentKind: row.attachment_kind,
          secureFileId: row.secure_file_id,
          displayFilename: row.display_filename,
          createdAt: timestamp(row.created_at),
          supersededAt: nullableTimestamp(row.superseded_at)
        })
      )
    );
  }

}
