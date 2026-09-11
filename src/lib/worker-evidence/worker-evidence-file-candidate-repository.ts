import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import {
  WorkerEvidenceConflictError,
  type WorkerEvidenceLifecycleStatus,
  type WorkerEvidenceRecordKind,
  type WorkerEvidenceVersionStatus
} from "./worker-evidence-domain";

export const WORKER_EVIDENCE_FILE_BINDING_KINDS = [
  "primary_certificate",
  "supporting_evidence",
  "experience_evidence",
  "employment_evidence",
  "skill_evidence",
  "leaving_letter"
] as const;

export type WorkerEvidenceFileBindingKind =
  (typeof WORKER_EVIDENCE_FILE_BINDING_KINDS)[number];

export type WorkerEvidenceFileCandidateRecord = Readonly<{
  candidateId: string;
  recordId: string;
  versionId: string;
  bindingKind: WorkerEvidenceFileBindingKind;
  secureFileId: string;
  reservationKey: string;
  displayFilename: string;
  expectedActiveBindingId: string | null;
  status: "pending" | "finalized";
  createdAt: string;
  finalizedAt: string | null;
}>;

export type FinalizedWorkerEvidenceAttachment = Readonly<{
  attachmentId: string;
  recordId: string;
  versionId: string;
  attachmentKind: Exclude<WorkerEvidenceFileBindingKind, "leaving_letter">;
  secureFileId: string;
  displayFilename: string;
  createdAt: string;
  supersededAt: string | null;
}>;

export type FinalizedWorkerLeavingLetter = Readonly<{
  leavingLetterId: string;
  employmentRecordId: string;
  employmentVersionId: string;
  secureFileId: string;
  displayFilename: string;
  status: "active";
  supersedesLeavingLetterId: string | null;
  createdAt: string;
  supersededAt: null;
}>;

type CandidateRow = {
  candidate_id: string;
  record_id: string;
  version_id: string;
  binding_kind: WorkerEvidenceFileBindingKind;
  secure_file_id: string;
  reservation_key: string;
  display_filename: string;
  expected_active_binding_id: string | null;
  candidate_status: "pending" | "finalized";
  created_at: string | Date;
  finalized_at: string | Date | null;
};

type LockedEvidence = {
  record_kind: WorkerEvidenceRecordKind;
  lifecycle_status: WorkerEvidenceLifecycleStatus;
  current_version_id: string;
  version_status: WorkerEvidenceVersionStatus;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function candidateFromRow(row: CandidateRow): WorkerEvidenceFileCandidateRecord {
  return Object.freeze({
    candidateId: row.candidate_id,
    recordId: row.record_id,
    versionId: row.version_id,
    bindingKind: row.binding_kind,
    secureFileId: row.secure_file_id,
    reservationKey: row.reservation_key,
    displayFilename: row.display_filename,
    expectedActiveBindingId: row.expected_active_binding_id,
    status: row.candidate_status,
    createdAt: timestamp(row.created_at),
    finalizedAt: nullableTimestamp(row.finalized_at)
  });
}

function expectedRecordKind(bindingKind: WorkerEvidenceFileBindingKind): WorkerEvidenceRecordKind {
  if (bindingKind === "primary_certificate" || bindingKind === "supporting_evidence") {
    return "qualification";
  }
  if (bindingKind === "experience_evidence") return "experience";
  if (bindingKind === "employment_evidence" || bindingKind === "leaving_letter") {
    return "employment";
  }
  return "skill";
}

async function lockEvidence(
  database: DatabaseClient,
  workerAccountId: string,
  recordId: string,
  versionId: string
): Promise<LockedEvidence | null> {
  const result = await database.query<LockedEvidence>(
    `SELECT records.record_kind,
            records.lifecycle_status,
            records.current_version_id,
            versions.version_status
       FROM worker_evidence_records AS records
       JOIN worker_evidence_versions AS versions
         ON versions.version_id=records.current_version_id
      WHERE records.worker_account_id=$1
        AND records.record_id=$2
        AND versions.version_id=$3
      FOR UPDATE OF records, versions`,
    [workerAccountId, recordId, versionId]
  );
  return result.rows[0] ?? null;
}

function assertCandidateTarget(
  locked: LockedEvidence,
  bindingKind: WorkerEvidenceFileBindingKind
): void {
  if (locked.record_kind !== expectedRecordKind(bindingKind)) {
    throw new WorkerEvidenceConflictError(
      "The pending evidence file no longer belongs to this record type."
    );
  }
  if (bindingKind === "leaving_letter") {
    if (
      locked.lifecycle_status !== "ended" ||
      locked.version_status !== "submitted"
    ) {
      throw new WorkerEvidenceConflictError(
        "A leaving letter can only be finalized on the current submitted ended employment."
      );
    }
    return;
  }
  if (
    locked.lifecycle_status !== "active" ||
    locked.version_status !== "draft"
  ) {
    throw new WorkerEvidenceConflictError(
      "Evidence files can only be finalized on the current active draft version."
    );
  }
}

export class DatabaseWorkerEvidenceFileCandidateRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient>) {}

  async create(input: Readonly<{
    workerAccountId: string;
    candidateId: string;
    recordId: string;
    versionId: string;
    bindingKind: WorkerEvidenceFileBindingKind;
    secureFileId: string;
    reservationKey: string;
    displayFilename: string;
    expectedActiveBindingId: string | null;
    now: string;
  }>): Promise<WorkerEvidenceFileCandidateRecord | null> {
    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      const locked = await lockEvidence(
        transaction,
        input.workerAccountId,
        input.recordId,
        input.versionId
      );
      if (!locked) return null;
      assertCandidateTarget(locked, input.bindingKind);

      await transaction.query(
        `INSERT INTO worker_evidence_file_candidates (
           candidate_id, record_id, version_id, binding_kind,
           secure_file_id, reservation_key, display_filename,
           expected_active_binding_id, candidate_status, created_at, finalized_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,NULL)`,
        [
          input.candidateId,
          input.recordId,
          input.versionId,
          input.bindingKind,
          input.secureFileId,
          input.reservationKey,
          input.displayFilename,
          input.expectedActiveBindingId,
          input.now
        ]
      );

      return Object.freeze({
        candidateId: input.candidateId,
        recordId: input.recordId,
        versionId: input.versionId,
        bindingKind: input.bindingKind,
        secureFileId: input.secureFileId,
        reservationKey: input.reservationKey,
        displayFilename: input.displayFilename,
        expectedActiveBindingId: input.expectedActiveBindingId,
        status: "pending" as const,
        createdAt: input.now,
        finalizedAt: null
      });
    });
  }

  async findForWorker(
    workerAccountId: string,
    candidateId: string
  ): Promise<WorkerEvidenceFileCandidateRecord | null> {
    const database = await this.clientPromise;
    const result = await database.query<CandidateRow>(
      `SELECT candidates.candidate_id,
              candidates.record_id,
              candidates.version_id,
              candidates.binding_kind,
              candidates.secure_file_id,
              candidates.reservation_key,
              candidates.display_filename,
              candidates.expected_active_binding_id,
              candidates.candidate_status,
              candidates.created_at,
              candidates.finalized_at
         FROM worker_evidence_file_candidates AS candidates
         JOIN worker_evidence_records AS records
           ON records.record_id=candidates.record_id
        WHERE records.worker_account_id=$1
          AND candidates.candidate_id=$2`,
      [workerAccountId, candidateId]
    );
    return result.rows[0] ? candidateFromRow(result.rows[0]) : null;
  }

  async listForWorker(
    workerAccountId: string,
    recordId: string
  ): Promise<readonly WorkerEvidenceFileCandidateRecord[]> {
    const database = await this.clientPromise;
    const result = await database.query<CandidateRow>(
      `SELECT candidates.candidate_id,
              candidates.record_id,
              candidates.version_id,
              candidates.binding_kind,
              candidates.secure_file_id,
              candidates.reservation_key,
              candidates.display_filename,
              candidates.expected_active_binding_id,
              candidates.candidate_status,
              candidates.created_at,
              candidates.finalized_at
         FROM worker_evidence_file_candidates AS candidates
         JOIN worker_evidence_records AS records
           ON records.record_id=candidates.record_id
        WHERE records.worker_account_id=$1
          AND records.record_id=$2
        ORDER BY candidates.created_at, candidates.candidate_id`,
      [workerAccountId, recordId]
    );
    return Object.freeze(result.rows.map(candidateFromRow));
  }

  async finalizeAttachment(input: Readonly<{
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    candidateId: string;
    secureFileId: string;
    attachmentId: string;
    now: string;
  }>): Promise<FinalizedWorkerEvidenceAttachment | null> {
    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      const candidateResult = await transaction.query<CandidateRow>(
        `SELECT candidates.candidate_id,
                candidates.record_id,
                candidates.version_id,
                candidates.binding_kind,
                candidates.secure_file_id,
                candidates.reservation_key,
                candidates.display_filename,
                candidates.expected_active_binding_id,
                candidates.candidate_status,
                candidates.created_at,
                candidates.finalized_at
           FROM worker_evidence_file_candidates AS candidates
           JOIN worker_evidence_records AS records
             ON records.record_id=candidates.record_id
          WHERE records.worker_account_id=$1
            AND candidates.candidate_id=$2
          FOR UPDATE OF candidates`,
        [input.workerAccountId, input.candidateId]
      );
      const candidateRow = candidateResult.rows[0];
      if (!candidateRow) return null;
      const candidate = candidateFromRow(candidateRow);
      if (
        candidate.status !== "pending" ||
        candidate.bindingKind === "leaving_letter" ||
        candidate.secureFileId !== input.secureFileId
      ) {
        throw new WorkerEvidenceConflictError(
          "The pending evidence candidate is no longer finalizable."
        );
      }

      const locked = await lockEvidence(
        transaction,
        input.workerAccountId,
        candidate.recordId,
        candidate.versionId
      );
      if (!locked) return null;
      assertCandidateTarget(locked, candidate.bindingKind);

      const active = await transaction.query<{ attachment_id: string }>(
        `SELECT attachment_id
           FROM worker_evidence_attachments
          WHERE record_id=$1
            AND version_id=$2
            AND attachment_kind=$3
            AND superseded_at IS NULL
          ORDER BY created_at DESC, attachment_id
          FOR UPDATE`,
        [candidate.recordId, candidate.versionId, candidate.bindingKind]
      );
      const activeId = active.rows[0]?.attachment_id ?? null;
      if (candidate.expectedActiveBindingId) {
        if (activeId !== candidate.expectedActiveBindingId) {
          throw new WorkerEvidenceConflictError(
            "The active evidence file changed while this file was scanning."
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
            candidate.expectedActiveBindingId,
            input.now,
            candidate.recordId,
            candidate.versionId,
            candidate.bindingKind
          ]
        );
        if (superseded.affectedRows !== 1) throw new WorkerEvidenceConflictError();
      } else if (activeId !== null) {
        throw new WorkerEvidenceConflictError(
          "An evidence file became active in this slot while the new file was scanning."
        );
      }

      await transaction.query(
        `INSERT INTO worker_evidence_attachments (
           attachment_id, record_id, version_id, attachment_kind,
           secure_file_id, display_filename, created_at, superseded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)`,
        [
          input.attachmentId,
          candidate.recordId,
          candidate.versionId,
          candidate.bindingKind,
          candidate.secureFileId,
          candidate.displayFilename,
          input.now
        ]
      );
      await transaction.query(
        `UPDATE worker_evidence_file_candidates
            SET candidate_status='finalized', finalized_at=$2
          WHERE candidate_id=$1 AND candidate_status='pending'`,
        [candidate.candidateId, input.now]
      );

      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(bindTrustedAuditActor(input.principal), {
        action: candidate.expectedActiveBindingId
          ? "worker_evidence.file.replaced"
          : "worker_evidence.file.attached",
        outcome: "succeeded",
        target: Object.freeze({ type: "resource", reference: candidate.recordId }),
        metadata: Object.freeze({
          versionId: candidate.versionId,
          attachmentId: input.attachmentId,
          attachmentKind: candidate.bindingKind,
          candidateId: candidate.candidateId
        })
      });

      return Object.freeze({
        attachmentId: input.attachmentId,
        recordId: candidate.recordId,
        versionId: candidate.versionId,
        attachmentKind: candidate.bindingKind,
        secureFileId: candidate.secureFileId,
        displayFilename: candidate.displayFilename,
        createdAt: input.now,
        supersededAt: null
      });
    });
  }

  async finalizeLeavingLetter(input: Readonly<{
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    candidateId: string;
    secureFileId: string;
    leavingLetterId: string;
    now: string;
  }>): Promise<FinalizedWorkerLeavingLetter | null> {
    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      const candidateResult = await transaction.query<CandidateRow>(
        `SELECT candidates.candidate_id,
                candidates.record_id,
                candidates.version_id,
                candidates.binding_kind,
                candidates.secure_file_id,
                candidates.reservation_key,
                candidates.display_filename,
                candidates.expected_active_binding_id,
                candidates.candidate_status,
                candidates.created_at,
                candidates.finalized_at
           FROM worker_evidence_file_candidates AS candidates
           JOIN worker_evidence_records AS records
             ON records.record_id=candidates.record_id
          WHERE records.worker_account_id=$1
            AND candidates.candidate_id=$2
          FOR UPDATE OF candidates`,
        [input.workerAccountId, input.candidateId]
      );
      const candidateRow = candidateResult.rows[0];
      if (!candidateRow) return null;
      const candidate = candidateFromRow(candidateRow);
      if (
        candidate.status !== "pending" ||
        candidate.bindingKind !== "leaving_letter" ||
        candidate.secureFileId !== input.secureFileId
      ) {
        throw new WorkerEvidenceConflictError(
          "The pending leaving-letter candidate is no longer finalizable."
        );
      }

      const locked = await lockEvidence(
        transaction,
        input.workerAccountId,
        candidate.recordId,
        candidate.versionId
      );
      if (!locked) return null;
      assertCandidateTarget(locked, "leaving_letter");

      const active = await transaction.query<{ leaving_letter_id: string }>(
        `SELECT leaving_letter_id
           FROM worker_employment_leaving_letters
          WHERE employment_record_id=$1
            AND status='active'
          FOR UPDATE`,
        [candidate.recordId]
      );
      const activeId = active.rows[0]?.leaving_letter_id ?? null;
      if (candidate.expectedActiveBindingId) {
        if (activeId !== candidate.expectedActiveBindingId) {
          throw new WorkerEvidenceConflictError(
            "The active leaving letter changed while this file was scanning."
          );
        }
        const superseded = await transaction.query(
          `UPDATE worker_employment_leaving_letters
              SET status='superseded', superseded_at=$2
            WHERE leaving_letter_id=$1
              AND employment_record_id=$3
              AND status='active'`,
          [candidate.expectedActiveBindingId, input.now, candidate.recordId]
        );
        if (superseded.affectedRows !== 1) throw new WorkerEvidenceConflictError();
      } else if (activeId !== null) {
        throw new WorkerEvidenceConflictError(
          "A leaving letter became active while the new file was scanning."
        );
      }

      await transaction.query(
        `INSERT INTO worker_employment_leaving_letters (
           leaving_letter_id, employment_record_id, employment_version_id,
           secure_file_id, display_filename, status,
           supersedes_leaving_letter_id, created_at, superseded_at
         ) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,NULL)`,
        [
          input.leavingLetterId,
          candidate.recordId,
          candidate.versionId,
          candidate.secureFileId,
          candidate.displayFilename,
          candidate.expectedActiveBindingId,
          input.now
        ]
      );
      await transaction.query(
        `UPDATE worker_evidence_file_candidates
            SET candidate_status='finalized', finalized_at=$2
          WHERE candidate_id=$1 AND candidate_status='pending'`,
        [candidate.candidateId, input.now]
      );

      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(bindTrustedAuditActor(input.principal), {
        action: candidate.expectedActiveBindingId
          ? "worker_evidence.leaving_letter.replaced"
          : "worker_evidence.leaving_letter.attached",
        outcome: "succeeded",
        target: Object.freeze({ type: "resource", reference: candidate.recordId }),
        metadata: Object.freeze({
          versionId: candidate.versionId,
          leavingLetterId: input.leavingLetterId,
          candidateId: candidate.candidateId
        })
      });

      return Object.freeze({
        leavingLetterId: input.leavingLetterId,
        employmentRecordId: candidate.recordId,
        employmentVersionId: candidate.versionId,
        secureFileId: candidate.secureFileId,
        displayFilename: candidate.displayFilename,
        status: "active" as const,
        supersedesLeavingLetterId: candidate.expectedActiveBindingId,
        createdAt: input.now,
        supersededAt: null
      });
    });
  }
}
