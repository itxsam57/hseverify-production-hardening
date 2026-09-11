import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  createAuditEventId,
  normalizeAuditMetadata
} from "../audit/audit-domain";
import { AUDIT_APPEND_SQL } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  WorkerIdentityAccessDeniedError,
  WorkerIdentityNotFoundError,
  assertWorkerIdentityPrincipal,
  normalizeWorkerIdentityReference,
  normalizeWorkerIdentityVersionReference
} from "./worker-identity-domain";
import { WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL } from "./worker-identity-repository";
import {
  WorkerIdentityEligibilityConflictError,
  WorkerIdentityWorkerIdBlockedError,
  assertTrustedWorkerIdentityEligibilityAuthority,
  createPermanentWorkerId,
  createWorkerIdentityDuplicateCheckId,
  createWorkerIdentityDuplicateDispositionId,
  createWorkerIdentityDuplicateSignalId,
  dispositionAllowsPermanentWorkerId,
  duplicateCheckStatusFromSignals,
  evaluateWorkerIdentityDuplicateSignals,
  isWorkerIdentityDuplicateDisposition,
  normalizePermanentWorkerId,
  normalizeWorkerIdentityDuplicateCheckReference,
  normalizeWorkerIdentityDuplicateReasonCode,
  type TrustedWorkerIdentityEligibilityAuthority,
  type WorkerIdentityDuplicateCheckRecord,
  type WorkerIdentityDuplicateCheckStatus,
  type WorkerIdentityDuplicateDisposition,
  type WorkerIdentityDuplicateDispositionRecord,
  type WorkerIdentityDuplicateFacts,
  type WorkerIdentityEligibilityStatus,
  type WorkerPermanentIdRecord
} from "./worker-identity-eligibility-domain";

const ELIGIBILITY_FACTS_SQL = `
SELECT
  identities.identity_id,
  identities.worker_account_id,
  identities.lifecycle_status,
  versions.identity_version_id,
  versions.version_status,
  drafts.legal_first_name,
  drafts.legal_last_name,
  drafts.date_of_birth,
  drafts.verified_email_normalized,
  drafts.verified_phone_e164,
  evidence.document_type,
  evidence.document_number
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
JOIN worker_identity_version_drafts AS drafts
  ON drafts.identity_version_id = versions.identity_version_id
JOIN worker_identity_evidence_bindings AS evidence
  ON evidence.identity_version_id = versions.identity_version_id
 AND evidence.worker_account_id = identities.worker_account_id
 AND evidence.purpose = 'identity_document'
 AND evidence.superseded_at IS NULL
WHERE identities.identity_id = $1`;

const ELIGIBILITY_FACTS_FOR_UPDATE_SQL = `${ELIGIBILITY_FACTS_SQL}
FOR UPDATE OF identities, versions`;

const ELIGIBILITY_CANDIDATES_SQL = `
SELECT
  identities.identity_id,
  identities.worker_account_id,
  identities.lifecycle_status,
  versions.identity_version_id,
  versions.version_status,
  drafts.legal_first_name,
  drafts.legal_last_name,
  drafts.date_of_birth,
  drafts.verified_email_normalized,
  drafts.verified_phone_e164,
  evidence.document_type,
  evidence.document_number
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
JOIN worker_identity_version_drafts AS drafts
  ON drafts.identity_version_id = versions.identity_version_id
JOIN worker_identity_evidence_bindings AS evidence
  ON evidence.identity_version_id = versions.identity_version_id
 AND evidence.worker_account_id = identities.worker_account_id
 AND evidence.purpose = 'identity_document'
 AND evidence.superseded_at IS NULL
WHERE identities.identity_id <> $1
  AND versions.version_status = 'submitted'
ORDER BY identities.identity_id`;

type EligibilityFactsRow = {
  identity_id: string;
  worker_account_id: string;
  lifecycle_status: string;
  identity_version_id: string;
  version_status: string;
  legal_first_name: string;
  legal_last_name: string;
  date_of_birth: string | Date;
  verified_email_normalized: string;
  verified_phone_e164: string;
  document_type: "passport" | "national_id" | "residence_permit";
  document_number: string;
};

type DuplicateCheckRow = {
  check_id: string;
  identity_id: string;
  identity_version_id: string;
  worker_account_id: string;
  check_sequence: number | string;
  check_status: string;
  created_at: string | Date;
};

type DuplicateDispositionRow = {
  disposition_id: string;
  check_id: string;
  disposition_sequence: number | string;
  disposition: string;
  reason_code: string;
  created_at: string | Date;
};

type PermanentWorkerIdRow = {
  permanent_worker_id: string;
  identity_id: string;
  identity_version_id: string;
  worker_account_id: string;
  issued_at: string | Date;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function factsFromRow(row: EligibilityFactsRow): WorkerIdentityDuplicateFacts {
  return Object.freeze({
    identityId: normalizeWorkerIdentityReference(row.identity_id),
    identityVersionId: normalizeWorkerIdentityVersionReference(row.identity_version_id),
    verifiedEmailNormalized: row.verified_email_normalized,
    verifiedPhoneE164: row.verified_phone_e164,
    legalFirstName: row.legal_first_name,
    legalLastName: row.legal_last_name,
    dateOfBirth: dateOnly(row.date_of_birth),
    documentType: row.document_type,
    documentNumber: row.document_number
  });
}

function checkFromRow(row: DuplicateCheckRow): WorkerIdentityDuplicateCheckRecord {
  const checkStatus = row.check_status;
  if (checkStatus !== "clear" && checkStatus !== "review_required") {
    throw new Error("Stored duplicate-check status is invalid.");
  }
  const checkSequence = Number(row.check_sequence);
  if (!Number.isSafeInteger(checkSequence) || checkSequence < 1) {
    throw new Error("Stored duplicate-check sequence is invalid.");
  }
  return Object.freeze({
    checkId: normalizeWorkerIdentityDuplicateCheckReference(row.check_id),
    identityId: normalizeWorkerIdentityReference(row.identity_id),
    identityVersionId: normalizeWorkerIdentityVersionReference(row.identity_version_id),
    workerAccountId: row.worker_account_id,
    checkSequence,
    checkStatus,
    createdAt: timestamp(row.created_at)
  });
}

function dispositionFromRow(
  row: DuplicateDispositionRow
): WorkerIdentityDuplicateDispositionRecord {
  if (!isWorkerIdentityDuplicateDisposition(row.disposition)) {
    throw new Error("Stored duplicate disposition is invalid.");
  }
  const dispositionSequence = Number(row.disposition_sequence);
  if (!Number.isSafeInteger(dispositionSequence) || dispositionSequence < 1) {
    throw new Error("Stored duplicate disposition sequence is invalid.");
  }
  return Object.freeze({
    dispositionId: row.disposition_id,
    checkId: normalizeWorkerIdentityDuplicateCheckReference(row.check_id),
    dispositionSequence,
    disposition: row.disposition,
    reasonCode: normalizeWorkerIdentityDuplicateReasonCode(row.reason_code),
    createdAt: timestamp(row.created_at)
  });
}

function workerIdFromRow(row: PermanentWorkerIdRow): WorkerPermanentIdRecord {
  return Object.freeze({
    permanentWorkerId: normalizePermanentWorkerId(row.permanent_worker_id),
    identityId: normalizeWorkerIdentityReference(row.identity_id),
    identityVersionId: normalizeWorkerIdentityVersionReference(row.identity_version_id),
    workerAccountId: row.worker_account_id,
    issuedAt: timestamp(row.issued_at)
  });
}

async function appendSystemIdentityAudit(
  database: DatabaseClient,
  input: Readonly<{
    action:
      | "worker_identity.duplicate.evaluated"
      | "worker_identity.duplicate.disposition.recorded"
      | "worker_identity.worker_id.issued";
    identityId: string;
    metadata: Readonly<Record<string, unknown>>;
  }>
): Promise<void> {
  const metadata = normalizeAuditMetadata({
    authorityComponent: "identity-assurance",
    ...input.metadata
  });
  await database.query(
    AUDIT_APPEND_SQL,
    [
      createAuditEventId(),
      null,
      null,
      null,
      null,
      input.action,
      "succeeded",
      null,
      "worker_identity",
      input.identityId,
      null,
      JSON.stringify(metadata)
    ]
  );
}

async function loadFacts(
  database: DatabaseClient,
  identityId: string,
  forUpdate: boolean
): Promise<EligibilityFactsRow | null> {
  const result = await database.query<EligibilityFactsRow>(
    forUpdate ? ELIGIBILITY_FACTS_FOR_UPDATE_SQL : ELIGIBILITY_FACTS_SQL,
    [identityId]
  );
  if (result.rows.length > 1) {
    throw new Error("Worker identity eligibility facts are not unique.");
  }
  return result.rows[0] ?? null;
}

async function loadLatestCheck(
  database: DatabaseClient,
  identityId: string,
  identityVersionId: string
): Promise<WorkerIdentityDuplicateCheckRecord | null> {
  const result = await database.query<DuplicateCheckRow>(
    `SELECT check_id, identity_id, identity_version_id, worker_account_id,
            check_sequence, check_status, created_at
     FROM worker_identity_duplicate_checks
     WHERE identity_id = $1 AND identity_version_id = $2
     ORDER BY check_sequence DESC
     LIMIT 1`,
    [identityId, identityVersionId]
  );
  return result.rows[0] ? checkFromRow(result.rows[0]) : null;
}

async function loadLatestDisposition(
  database: DatabaseClient,
  checkId: string
): Promise<WorkerIdentityDuplicateDispositionRecord | null> {
  const result = await database.query<DuplicateDispositionRow>(
    `SELECT disposition_id, check_id, disposition_sequence,
            disposition, reason_code, created_at
     FROM worker_identity_duplicate_dispositions
     WHERE check_id = $1
     ORDER BY disposition_sequence DESC
     LIMIT 1`,
    [checkId]
  );
  return result.rows[0] ? dispositionFromRow(result.rows[0]) : null;
}

async function loadWorkerIdByIdentity(
  database: DatabaseClient,
  identityId: string
): Promise<WorkerPermanentIdRecord | null> {
  const result = await database.query<PermanentWorkerIdRow>(
    `SELECT permanent_worker_id, identity_id, identity_version_id,
            worker_account_id, issued_at
     FROM worker_identity_worker_ids
     WHERE identity_id = $1`,
    [identityId]
  );
  if (result.rows.length > 1) {
    throw new Error("Permanent Worker ID identity uniqueness is corrupted.");
  }
  return result.rows[0] ? workerIdFromRow(result.rows[0]) : null;
}

export interface WorkerIdentityEligibilityRepository {
  evaluate(
    authority: TrustedWorkerIdentityEligibilityAuthority,
    identityId: string
  ): Promise<WorkerIdentityDuplicateCheckRecord>;
  recordDisposition(
    authority: TrustedWorkerIdentityEligibilityAuthority,
    input: Readonly<{
      checkId: string;
      disposition: WorkerIdentityDuplicateDisposition;
      reasonCode: string;
    }>
  ): Promise<WorkerIdentityDuplicateDispositionRecord>;
  issuePermanentWorkerId(
    authority: TrustedWorkerIdentityEligibilityAuthority,
    identityId: string
  ): Promise<WorkerPermanentIdRecord>;
  loadOwnStatus(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityEligibilityStatus | null>;
}

export class DatabaseWorkerIdentityEligibilityRepository
  implements WorkerIdentityEligibilityRepository
{
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private async client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async evaluate(
    authority: TrustedWorkerIdentityEligibilityAuthority,
    identityIdInput: string
  ): Promise<WorkerIdentityDuplicateCheckRecord> {
    assertTrustedWorkerIdentityEligibilityAuthority(authority);
    const identityId = normalizeWorkerIdentityReference(identityIdInput);
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const targetRow = await loadFacts(transaction, identityId, true);
      if (!targetRow) throw new WorkerIdentityNotFoundError();
      if (
        targetRow.version_status !== "submitted" ||
        !["manual_review", "more_info", "verified"].includes(
          targetRow.lifecycle_status
        )
      ) {
        throw new WorkerIdentityEligibilityConflictError(
          "Duplicate evaluation requires the current submitted post-check identity version."
        );
      }
      if (await loadWorkerIdByIdentity(transaction, identityId)) {
        throw new WorkerIdentityEligibilityConflictError(
          "Duplicate eligibility is immutable after permanent Worker ID issuance."
        );
      }

      const target = factsFromRow(targetRow);
      const candidateRows = await transaction.query<EligibilityFactsRow>(
        ELIGIBILITY_CANDIDATES_SQL,
        [identityId]
      );
      const candidates = candidateRows.rows.map(factsFromRow);
      const signals = evaluateWorkerIdentityDuplicateSignals(target, candidates);
      const checkStatus = duplicateCheckStatusFromSignals(signals);
      const sequenceResult = await transaction.query<{ next_sequence: number | string }>(
        `SELECT COALESCE(MAX(check_sequence), 0) + 1 AS next_sequence
         FROM worker_identity_duplicate_checks
         WHERE identity_version_id = $1`,
        [target.identityVersionId]
      );
      const checkSequence = Number(sequenceResult.rows[0]?.next_sequence ?? 1);
      if (!Number.isSafeInteger(checkSequence) || checkSequence < 1) {
        throw new Error("Duplicate-check sequence could not be derived.");
      }

      const checkId = createWorkerIdentityDuplicateCheckId();
      const inserted = await transaction.query<DuplicateCheckRow>(
        `INSERT INTO worker_identity_duplicate_checks (
           check_id, identity_id, identity_version_id, worker_account_id,
           check_sequence, check_status
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING check_id, identity_id, identity_version_id, worker_account_id,
                   check_sequence, check_status, created_at`,
        [
          checkId,
          target.identityId,
          target.identityVersionId,
          targetRow.worker_account_id,
          checkSequence,
          checkStatus
        ]
      );
      if (inserted.rows.length !== 1) {
        throw new WorkerIdentityEligibilityConflictError();
      }

      for (const signal of signals) {
        await transaction.query(
          `INSERT INTO worker_identity_duplicate_signals (
             signal_id, check_id, candidate_identity_id,
             candidate_identity_version_id, signal_type, signal_strength
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            createWorkerIdentityDuplicateSignalId(),
            checkId,
            signal.candidateIdentityId,
            signal.candidateIdentityVersionId,
            signal.signalType,
            signal.strength
          ]
        );
      }

      await appendSystemIdentityAudit(transaction, {
        action: "worker_identity.duplicate.evaluated",
        identityId: target.identityId,
        metadata: {
          checkId,
          checkSequence,
          checkStatus,
          signalCount: signals.length,
          signalTypes: [...new Set(signals.map((signal) => signal.signalType))]
        }
      });

      return checkFromRow(inserted.rows[0]);
    });
  }

  async recordDisposition(
    authority: TrustedWorkerIdentityEligibilityAuthority,
    input: Readonly<{
      checkId: string;
      disposition: WorkerIdentityDuplicateDisposition;
      reasonCode: string;
    }>
  ): Promise<WorkerIdentityDuplicateDispositionRecord> {
    assertTrustedWorkerIdentityEligibilityAuthority(authority);
    const checkId = normalizeWorkerIdentityDuplicateCheckReference(input.checkId);
    if (!isWorkerIdentityDuplicateDisposition(input.disposition)) {
      throw new WorkerIdentityEligibilityConflictError("Duplicate disposition is invalid.");
    }
    const reasonCode = normalizeWorkerIdentityDuplicateReasonCode(input.reasonCode);
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const checkResult = await transaction.query<DuplicateCheckRow>(
        `SELECT check_id, identity_id, identity_version_id, worker_account_id,
                check_sequence, check_status, created_at
         FROM worker_identity_duplicate_checks
         WHERE check_id = $1
         FOR UPDATE`,
        [checkId]
      );
      if (checkResult.rows.length !== 1) {
        throw new WorkerIdentityEligibilityConflictError("Duplicate check is unavailable.");
      }
      const check = checkFromRow(checkResult.rows[0]);
      if (check.checkStatus !== "review_required") {
        throw new WorkerIdentityEligibilityConflictError(
          "A clear duplicate check does not require a disposition."
        );
      }
      const latest = await loadLatestCheck(
        transaction,
        check.identityId,
        check.identityVersionId
      );
      if (!latest || latest.checkId !== check.checkId) {
        throw new WorkerIdentityEligibilityConflictError(
          "Duplicate disposition cannot target a stale check."
        );
      }

      const previous = await loadLatestDisposition(transaction, checkId);
      if (
        previous &&
        previous.disposition === input.disposition &&
        previous.reasonCode === reasonCode
      ) {
        return previous;
      }
      const dispositionSequence = (previous?.dispositionSequence ?? 0) + 1;
      const dispositionId = createWorkerIdentityDuplicateDispositionId();
      const inserted = await transaction.query<DuplicateDispositionRow>(
        `INSERT INTO worker_identity_duplicate_dispositions (
           disposition_id, check_id, disposition_sequence,
           disposition, reason_code, authority_component
         ) VALUES ($1, $2, $3, $4, $5, 'identity-assurance')
         RETURNING disposition_id, check_id, disposition_sequence,
                   disposition, reason_code, created_at`,
        [
          dispositionId,
          checkId,
          dispositionSequence,
          input.disposition,
          reasonCode
        ]
      );
      if (inserted.rows.length !== 1) {
        throw new WorkerIdentityEligibilityConflictError();
      }

      await appendSystemIdentityAudit(transaction, {
        action: "worker_identity.duplicate.disposition.recorded",
        identityId: check.identityId,
        metadata: {
          checkId,
          disposition: input.disposition,
          dispositionSequence,
          reasonCode
        }
      });
      return dispositionFromRow(inserted.rows[0]);
    });
  }

  async issuePermanentWorkerId(
    authority: TrustedWorkerIdentityEligibilityAuthority,
    identityIdInput: string
  ): Promise<WorkerPermanentIdRecord> {
    assertTrustedWorkerIdentityEligibilityAuthority(authority);
    const identityId = normalizeWorkerIdentityReference(identityIdInput);
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const existing = await loadWorkerIdByIdentity(transaction, identityId);
      if (existing) return existing;

      const targetRow = await loadFacts(transaction, identityId, true);
      if (!targetRow) throw new WorkerIdentityNotFoundError();
      if (
        targetRow.lifecycle_status !== "verified" ||
        targetRow.version_status !== "submitted"
      ) {
        throw new WorkerIdentityWorkerIdBlockedError(
          "Permanent Worker ID requires a verified current submitted identity."
        );
      }
      const identityVersionId = normalizeWorkerIdentityVersionReference(
        targetRow.identity_version_id
      );
      const latestCheck = await loadLatestCheck(
        transaction,
        identityId,
        identityVersionId
      );
      if (!latestCheck) {
        throw new WorkerIdentityWorkerIdBlockedError(
          "Permanent Worker ID requires a current duplicate evaluation."
        );
      }
      const latestDisposition = await loadLatestDisposition(
        transaction,
        latestCheck.checkId
      );
      if (
        !dispositionAllowsPermanentWorkerId(
          latestCheck.checkStatus,
          latestDisposition?.disposition ?? null
        )
      ) {
        throw new WorkerIdentityWorkerIdBlockedError();
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const permanentWorkerId = createPermanentWorkerId();
        const inserted = await transaction.query<PermanentWorkerIdRow>(
          `INSERT INTO worker_identity_worker_ids (
             permanent_worker_id, identity_id, identity_version_id,
             worker_account_id, issued_by_component
           ) VALUES ($1, $2, $3, $4, 'identity-assurance')
           ON CONFLICT DO NOTHING
           RETURNING permanent_worker_id, identity_id, identity_version_id,
                     worker_account_id, issued_at`,
          [
            permanentWorkerId,
            identityId,
            identityVersionId,
            targetRow.worker_account_id
          ]
        );
        if (inserted.rows.length === 1) {
          await appendSystemIdentityAudit(transaction, {
            action: "worker_identity.worker_id.issued",
            identityId,
            metadata: {
              identityVersionId,
              duplicateCheckId: latestCheck.checkId
            }
          });
          return workerIdFromRow(inserted.rows[0]);
        }

        const concurrent = await loadWorkerIdByIdentity(transaction, identityId);
        if (concurrent) return concurrent;
      }

      throw new WorkerIdentityEligibilityConflictError(
        "A unique permanent Worker ID could not be allocated."
      );
    });
  }

  async loadOwnStatus(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityEligibilityStatus | null> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const authority = await transaction.query<{ session_id: string }>(
        WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL,
        [worker.sessionId, worker.accountId]
      );
      if (authority.rows.length !== 1) {
        throw new WorkerIdentityAccessDeniedError();
      }

      const identityResult = await transaction.query<{
        identity_id: string;
        identity_version_id: string;
      }>(
        `SELECT identities.identity_id, versions.identity_version_id
         FROM worker_identities AS identities
         JOIN worker_identity_versions AS versions
           ON versions.identity_id = identities.identity_id
          AND versions.version_number = identities.current_version_number
         WHERE identities.worker_account_id = $1`,
        [worker.accountId]
      );
      if (identityResult.rows.length === 0) return null;
      if (identityResult.rows.length !== 1) {
        throw new Error("Worker identity ownership uniqueness is corrupted.");
      }

      const identityId = normalizeWorkerIdentityReference(
        identityResult.rows[0].identity_id
      );
      const identityVersionId = normalizeWorkerIdentityVersionReference(
        identityResult.rows[0].identity_version_id
      );
      const latestCheck = await loadLatestCheck(
        transaction,
        identityId,
        identityVersionId
      );
      const latestDisposition = latestCheck
        ? await loadLatestDisposition(transaction, latestCheck.checkId)
        : null;
      const permanentWorkerId = await loadWorkerIdByIdentity(
        transaction,
        identityId
      );

      return Object.freeze({
        duplicateStatus: latestCheck?.checkStatus ?? "not_evaluated",
        latestDisposition: latestDisposition?.disposition ?? null,
        permanentWorkerId: permanentWorkerId?.permanentWorkerId ?? null
      });
    });
  }
}

let repository: WorkerIdentityEligibilityRepository | null = null;

export function getWorkerIdentityEligibilityRepository(): WorkerIdentityEligibilityRepository {
  repository ??= new DatabaseWorkerIdentityEligibilityRepository();
  return repository;
}
