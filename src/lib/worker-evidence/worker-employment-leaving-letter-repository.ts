import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { WorkerEvidenceConflictError } from "./worker-evidence-domain";

export type WorkerEmploymentLeavingLetterRecord = Readonly<{
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

type LeavingLetterRow = {
  leaving_letter_id: string;
  employment_record_id: string;
  employment_version_id: string;
  secure_file_id: string;
  display_filename: string;
  status: "active" | "superseded";
  supersedes_leaving_letter_id: string | null;
  created_at: string | Date;
  superseded_at: string | Date | null;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function fromRow(row: LeavingLetterRow): WorkerEmploymentLeavingLetterRecord {
  return Object.freeze({
    leavingLetterId: row.leaving_letter_id,
    employmentRecordId: row.employment_record_id,
    employmentVersionId: row.employment_version_id,
    secureFileId: row.secure_file_id,
    displayFilename: row.display_filename,
    status: row.status,
    supersedesLeavingLetterId: row.supersedes_leaving_letter_id,
    createdAt: timestamp(row.created_at),
    supersededAt: nullableTimestamp(row.superseded_at)
  });
}

export class DatabaseWorkerEmploymentLeavingLetterRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient>) {}

  async bind(input: Readonly<{
    principal: AuthorizationPrincipal;
    workerAccountId: string;
    recordId: string;
    versionId: string;
    expectedActiveLeavingLetterId: string | null;
    leavingLetterId: string;
    secureFileId: string;
    displayFilename: string;
    now: string;
  }>): Promise<WorkerEmploymentLeavingLetterRecord | null> {
    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      const employment = await transaction.query<{
        version_status: "draft" | "submitted" | "superseded";
      }>(
        `SELECT versions.version_status
           FROM worker_evidence_records AS records
           JOIN worker_evidence_versions AS versions
             ON versions.version_id=records.current_version_id
          WHERE records.worker_account_id=$1
            AND records.record_id=$2
            AND records.record_kind='employment'
            AND records.lifecycle_status='ended'
            AND versions.version_id=$3
          FOR UPDATE OF records, versions`,
        [input.workerAccountId, input.recordId, input.versionId]
      );
      const current = employment.rows[0];
      if (!current) return null;
      if (current.version_status !== "submitted") {
        throw new WorkerEvidenceConflictError(
          "A leaving letter can only be attached to the submitted ended employment version."
        );
      }

      const active = await transaction.query<{ leaving_letter_id: string }>(
        `SELECT leaving_letter_id
           FROM worker_employment_leaving_letters
          WHERE employment_record_id=$1
            AND status='active'
          FOR UPDATE`,
        [input.recordId]
      );
      const activeId = active.rows[0]?.leaving_letter_id ?? null;

      if (input.expectedActiveLeavingLetterId) {
        if (activeId !== input.expectedActiveLeavingLetterId) {
          throw new WorkerEvidenceConflictError(
            "The leaving letter changed in another session. Refresh and try again."
          );
        }
        const superseded = await transaction.query(
          `UPDATE worker_employment_leaving_letters
              SET status='superseded', superseded_at=$2
            WHERE leaving_letter_id=$1
              AND employment_record_id=$3
              AND status='active'`,
          [input.expectedActiveLeavingLetterId, input.now, input.recordId]
        );
        if (superseded.affectedRows !== 1) {
          throw new WorkerEvidenceConflictError(
            "The leaving letter changed in another session. Refresh and try again."
          );
        }
      } else if (activeId !== null) {
        throw new WorkerEvidenceConflictError(
          "A leaving letter is already active. Refresh before replacing it."
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
          input.recordId,
          input.versionId,
          input.secureFileId,
          input.displayFilename,
          input.expectedActiveLeavingLetterId,
          input.now
        ]
      );

      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(bindTrustedAuditActor(input.principal), {
        action: input.expectedActiveLeavingLetterId
          ? "worker_evidence.leaving_letter.replaced"
          : "worker_evidence.leaving_letter.attached",
        outcome: "succeeded",
        target: Object.freeze({ type: "resource", reference: input.recordId }),
        metadata: Object.freeze({
          versionId: input.versionId,
          leavingLetterId: input.leavingLetterId
        })
      });

      return Object.freeze({
        leavingLetterId: input.leavingLetterId,
        employmentRecordId: input.recordId,
        employmentVersionId: input.versionId,
        secureFileId: input.secureFileId,
        displayFilename: input.displayFilename,
        status: "active" as const,
        supersedesLeavingLetterId: input.expectedActiveLeavingLetterId,
        createdAt: input.now,
        supersededAt: null
      });
    });
  }

  async listForWorker(
    workerAccountId: string,
    recordId: string
  ): Promise<readonly WorkerEmploymentLeavingLetterRecord[]> {
    const database = await this.clientPromise;
    const result = await database.query<LeavingLetterRow>(
      `WITH RECURSIVE leaving_letter_chain AS (
         SELECT letters.*, 1 AS lineage_depth
           FROM worker_employment_leaving_letters AS letters
           JOIN worker_evidence_records AS records
             ON records.record_id=letters.employment_record_id
          WHERE records.worker_account_id=$1
            AND records.record_id=$2
            AND records.record_kind='employment'
            AND letters.supersedes_leaving_letter_id IS NULL
         UNION ALL
         SELECT replacement.*, prior.lineage_depth + 1
           FROM worker_employment_leaving_letters AS replacement
           JOIN leaving_letter_chain AS prior
             ON replacement.supersedes_leaving_letter_id=prior.leaving_letter_id
       )
       SELECT leaving_letter_id,
              employment_record_id,
              employment_version_id,
              secure_file_id,
              display_filename,
              status,
              supersedes_leaving_letter_id,
              created_at,
              superseded_at
         FROM leaving_letter_chain
        ORDER BY lineage_depth, created_at, leaving_letter_id`,
      [workerAccountId, recordId]
    );
    return Object.freeze(result.rows.map(fromRow));
  }
}
