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
  createWorkerIdentityEvidenceBindingId,
  type WorkerIdentityEvidencePurpose
} from "./worker-identity-evidence-domain";
import {
  WorkerIdentityAccessDeniedError,
  WorkerIdentityConflictError,
  WorkerIdentityNotFoundError,
  assertWorkerIdentityPrincipal,
  createWorkerIdentityVersionId,
  normalizeWorkerIdentityLockVersion
} from "./worker-identity-domain";
import { WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL } from "./worker-identity-repository";
import {
  WorkerIdentityCorrectionConflictError,
  WorkerIdentityCorrectionNotFoundError,
  assertTrustedWorkerIdentityCorrectionAuthority,
  createWorkerIdentityCorrectionDecisionId,
  createWorkerIdentityCorrectionEvidenceOriginId,
  createWorkerIdentityCorrectionRequestId,
  isWorkerIdentityCorrectionDecision,
  normalizeWorkerIdentityCorrectionReason,
  normalizeWorkerIdentityCorrectionReasonCode,
  normalizeWorkerIdentityCorrectionRequestReference,
  type TrustedWorkerIdentityCorrectionAuthority,
  type WorkerIdentityCorrectionDecision,
  type WorkerIdentityCorrectionRecord
} from "./worker-identity-correction-domain";

const CURRENT_CORRECTION_CONTEXT_SQL = `
SELECT
  identities.identity_id,
  identities.worker_account_id,
  identities.lifecycle_status,
  identities.current_version_number,
  identities.lock_version,
  versions.identity_version_id,
  versions.version_number,
  versions.parent_version_id,
  versions.version_kind,
  versions.version_status,
  versions.submitted_at
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
WHERE identities.worker_account_id = $1`;

const CURRENT_CORRECTION_CONTEXT_FOR_UPDATE_SQL = `${CURRENT_CORRECTION_CONTEXT_SQL}
FOR UPDATE OF identities, versions`;

const LATEST_CORRECTION_SQL = `
SELECT
  requests.correction_request_id,
  requests.identity_id,
  requests.correction_version_id,
  requests.parent_version_id,
  requests.worker_account_id,
  requests.reason,
  requests.requested_at,
  versions.submitted_at,
  decisions.decision,
  decisions.reason_code,
  decisions.decided_at
FROM worker_identity_correction_requests AS requests
JOIN worker_identity_versions AS versions
  ON versions.identity_version_id = requests.correction_version_id
LEFT JOIN worker_identity_correction_decisions AS decisions
  ON decisions.correction_request_id = requests.correction_request_id
WHERE requests.worker_account_id = $1
ORDER BY requests.requested_at DESC, requests.correction_request_id DESC
LIMIT 1`;

type CorrectionContextRow = {
  identity_id: string;
  worker_account_id: string;
  lifecycle_status: string;
  current_version_number: number | string;
  lock_version: number | string;
  identity_version_id: string;
  version_number: number | string;
  parent_version_id: string | null;
  version_kind: string;
  version_status: string;
  submitted_at: string | Date | null;
};

type CorrectionRow = {
  correction_request_id: string;
  identity_id: string;
  correction_version_id: string;
  parent_version_id: string;
  worker_account_id: string;
  reason: string;
  requested_at: string | Date;
  submitted_at: string | Date | null;
  decision: string | null;
  reason_code: string | null;
  decided_at: string | Date | null;
};

type EvidenceCarryRow = {
  binding_id: string;
  purpose: WorkerIdentityEvidencePurpose;
  secure_file_id: string;
  document_type: "passport" | "national_id" | "residence_permit" | null;
  document_number: string | null;
  issue_date: string | Date | null;
  expiry_date: string | Date | null;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeNumber(value: number | string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Stored Worker identity ${label} is invalid.`);
  }
  return parsed;
}

function correctionFromRow(row: CorrectionRow): WorkerIdentityCorrectionRecord {
  const decision = row.decision;
  if (decision !== null && !isWorkerIdentityCorrectionDecision(decision)) {
    throw new Error("Stored Worker identity correction decision is invalid.");
  }
  return Object.freeze({
    correctionRequestId: normalizeWorkerIdentityCorrectionRequestReference(
      row.correction_request_id
    ),
    identityId: row.identity_id,
    correctionVersionId: row.correction_version_id,
    parentVersionId: row.parent_version_id,
    requestedByAccountId: row.worker_account_id,
    reason: row.reason,
    requestedAt: timestamp(row.requested_at),
    submittedAt: row.submitted_at ? timestamp(row.submitted_at) : null,
    decision,
    decisionReasonCode: row.reason_code,
    decidedAt: row.decided_at ? timestamp(row.decided_at) : null
  });
}

async function assertLiveWorker(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<AuthorizationPrincipal & Readonly<{ activeRole: "worker" }>> {
  const worker = assertWorkerIdentityPrincipal(principal);
  const result = await database.query<{ session_id: string }>(
    WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL,
    [worker.sessionId, worker.accountId]
  );
  if (result.rows.length !== 1) throw new WorkerIdentityAccessDeniedError();
  return worker;
}

async function loadCurrentContext(
  database: DatabaseClient,
  workerAccountId: string,
  forUpdate: boolean
): Promise<CorrectionContextRow | null> {
  const result = await database.query<CorrectionContextRow>(
    forUpdate
      ? CURRENT_CORRECTION_CONTEXT_FOR_UPDATE_SQL
      : CURRENT_CORRECTION_CONTEXT_SQL,
    [workerAccountId]
  );
  if (result.rows.length > 1) {
    throw new Error("Worker identity current correction context is not unique.");
  }
  return result.rows[0] ?? null;
}

async function loadLatestCorrection(
  database: DatabaseClient,
  workerAccountId: string
): Promise<WorkerIdentityCorrectionRecord | null> {
  const result = await database.query<CorrectionRow>(LATEST_CORRECTION_SQL, [
    workerAccountId
  ]);
  return result.rows[0] ? correctionFromRow(result.rows[0]) : null;
}

async function appendWorkerCorrectionAudit(
  database: DatabaseClient,
  worker: AuthorizationPrincipal & Readonly<{ activeRole: "worker" }>,
  identityId: string,
  metadataInput: Readonly<Record<string, unknown>>
): Promise<void> {
  const metadata = normalizeAuditMetadata(metadataInput);
  await database.query(AUDIT_APPEND_SQL, [
    createAuditEventId(),
    worker.accountId,
    "worker",
    null,
    null,
    "worker_identity.status.changed",
    "succeeded",
    null,
    "worker_identity",
    identityId,
    null,
    JSON.stringify(metadata)
  ]);
}

async function appendSystemCorrectionAudit(
  database: DatabaseClient,
  identityId: string,
  metadataInput: Readonly<Record<string, unknown>>
): Promise<void> {
  const metadata = normalizeAuditMetadata({
    authorityComponent: "identity-assurance",
    ...metadataInput
  });
  await database.query(AUDIT_APPEND_SQL, [
    createAuditEventId(),
    null,
    null,
    null,
    null,
    "worker_identity.status.changed",
    "succeeded",
    null,
    "worker_identity",
    identityId,
    null,
    JSON.stringify(metadata)
  ]);
}

async function nextVersionNumber(
  database: DatabaseClient,
  identityId: string
): Promise<number> {
  const result = await database.query<{ next_version: number | string }>(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM worker_identity_versions
     WHERE identity_id = $1`,
    [identityId]
  );
  return safeNumber(result.rows[0]?.next_version ?? 0, "next version number");
}

async function carryForwardAvailableEvidence(
  database: DatabaseClient,
  input: Readonly<{
    correctionRequestId: string;
    parentVersionId: string;
    correctionVersionId: string;
    workerAccountId: string;
  }>
): Promise<void> {
  const evidence = await database.query<EvidenceCarryRow>(
    `SELECT bindings.binding_id, bindings.purpose, bindings.secure_file_id,
            bindings.document_type, bindings.document_number,
            bindings.issue_date, bindings.expiry_date
     FROM worker_identity_evidence_bindings AS bindings
     JOIN platform_secure_files AS files
       ON files.file_id = bindings.secure_file_id
      AND files.owner_account_id = $2
      AND files.owner_role = 'worker'
      AND files.tenant_id IS NULL
      AND files.membership_id IS NULL
      AND files.lifecycle_status = 'available'
     WHERE bindings.identity_version_id = $1
       AND bindings.worker_account_id = $2
       AND bindings.binding_status = 'active'
       AND (
         bindings.purpose <> 'identity_document' OR
         bindings.expiry_date IS NULL OR
         bindings.expiry_date >= CURRENT_DATE
       )
     ORDER BY bindings.purpose`,
    [input.parentVersionId, input.workerAccountId]
  );

  for (const source of evidence.rows) {
    const carriedBindingId = createWorkerIdentityEvidenceBindingId();
    await database.query(
      `INSERT INTO worker_identity_evidence_bindings (
         binding_id, identity_version_id, worker_account_id, purpose,
         secure_file_id, document_type, document_number, issue_date, expiry_date,
         binding_status, supersedes_binding_id, created_by_account_id
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9,
         'active', NULL, $3
       )`,
      [
        carriedBindingId,
        input.correctionVersionId,
        input.workerAccountId,
        source.purpose,
        source.secure_file_id,
        source.document_type,
        source.document_number,
        source.issue_date,
        source.expiry_date
      ]
    );
    await database.query(
      `INSERT INTO worker_identity_correction_evidence_origins (
         origin_id, correction_request_id, purpose,
         source_binding_id, carried_binding_id
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        createWorkerIdentityCorrectionEvidenceOriginId(),
        input.correctionRequestId,
        source.purpose,
        source.binding_id,
        carriedBindingId
      ]
    );
  }
}

export interface WorkerIdentityCorrectionRepository {
  loadOwn(principal: AuthorizationPrincipal): Promise<WorkerIdentityCorrectionRecord | null>;
  requestOwn(
    principal: AuthorizationPrincipal,
    input: Readonly<{ reason: string; expectedLockVersion: number }>
  ): Promise<WorkerIdentityCorrectionRecord>;
  submitOwn(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentityCorrectionRecord>;
  decide(
    authority: TrustedWorkerIdentityCorrectionAuthority,
    input: Readonly<{
      correctionRequestId: string;
      decision: WorkerIdentityCorrectionDecision;
      reasonCode: string;
    }>
  ): Promise<WorkerIdentityCorrectionRecord>;
}

export class DatabaseWorkerIdentityCorrectionRepository
  implements WorkerIdentityCorrectionRepository
{
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private async client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async loadOwn(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityCorrectionRecord | null> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const worker = await assertLiveWorker(transaction, principal);
      return loadLatestCorrection(transaction, worker.accountId);
    });
  }

  async requestOwn(
    principal: AuthorizationPrincipal,
    input: Readonly<{ reason: string; expectedLockVersion: number }>
  ): Promise<WorkerIdentityCorrectionRecord> {
    const reason = normalizeWorkerIdentityCorrectionReason(input.reason);
    const expectedLockVersion = normalizeWorkerIdentityLockVersion(
      input.expectedLockVersion
    );
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const worker = await assertLiveWorker(transaction, principal);
      const current = await loadCurrentContext(transaction, worker.accountId, true);
      if (!current) throw new WorkerIdentityNotFoundError();
      const currentVersionNumber = safeNumber(
        current.current_version_number,
        "current version number"
      );
      const lockVersion = safeNumber(current.lock_version, "lock version");
      if (lockVersion !== expectedLockVersion) {
        throw new WorkerIdentityConflictError();
      }
      if (
        current.lifecycle_status !== "verified" ||
        current.version_status !== "submitted" ||
        safeNumber(current.version_number, "version number") !== currentVersionNumber
      ) {
        throw new WorkerIdentityCorrectionConflictError(
          "A correction can start only from the current verified submitted identity version."
        );
      }

      const correctionVersionId = createWorkerIdentityVersionId();
      const correctionRequestId = createWorkerIdentityCorrectionRequestId();
      const correctionVersionNumber = await nextVersionNumber(
        transaction,
        current.identity_id
      );

      await transaction.query(
        `INSERT INTO worker_identity_versions (
           identity_version_id, identity_id, version_number,
           parent_version_id, version_kind, version_status,
           created_by_account_id
         ) VALUES ($1, $2, $3, $4, 'correction', 'draft', $5)`,
        [
          correctionVersionId,
          current.identity_id,
          correctionVersionNumber,
          current.identity_version_id,
          worker.accountId
        ]
      );

      await transaction.query(
        `INSERT INTO worker_identity_correction_requests (
           correction_request_id, identity_id, correction_version_id,
           parent_version_id, worker_account_id, reason
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          correctionRequestId,
          current.identity_id,
          correctionVersionId,
          current.identity_version_id,
          worker.accountId,
          reason
        ]
      );

      const advanced = await transaction.query<{ identity_id: string }>(
        `UPDATE worker_identities
         SET lifecycle_status = 'correction_pending',
             current_version_number = $1,
             lock_version = lock_version + 1
         WHERE identity_id = $2
           AND worker_account_id = $3
           AND lifecycle_status = 'verified'
           AND current_version_number = $4
           AND lock_version = $5
         RETURNING identity_id`,
        [
          correctionVersionNumber,
          current.identity_id,
          worker.accountId,
          currentVersionNumber,
          expectedLockVersion
        ]
      );
      if (advanced.rows.length !== 1) throw new WorkerIdentityConflictError();

      const copiedDraft = await transaction.query<{ identity_version_id: string }>(
        `INSERT INTO worker_identity_version_drafts (
           identity_version_id, draft_revision,
           legal_first_name, legal_last_name, previous_legal_name,
           date_of_birth, nationality, country_of_residence,
           verified_email_normalized, email_verified_at,
           verified_phone_e164, phone_verified_at
         )
         SELECT $1, 1,
                legal_first_name, legal_last_name, previous_legal_name,
                date_of_birth, nationality, country_of_residence,
                verified_email_normalized, email_verified_at,
                verified_phone_e164, phone_verified_at
         FROM worker_identity_version_drafts
         WHERE identity_version_id = $2
         RETURNING identity_version_id`,
        [correctionVersionId, current.identity_version_id]
      );
      if (copiedDraft.rows.length !== 1) {
        throw new WorkerIdentityCorrectionConflictError(
          "Verified identity details could not be carried into the correction version."
        );
      }

      await carryForwardAvailableEvidence(transaction, {
        correctionRequestId,
        parentVersionId: current.identity_version_id,
        correctionVersionId,
        workerAccountId: worker.accountId
      });

      await appendWorkerCorrectionAudit(transaction, worker, current.identity_id, {
        eventType: "correction_requested",
        fromStatus: "verified",
        toStatus: "correction_pending",
        parentVersionNumber: currentVersionNumber,
        correctionVersionNumber,
        correctionRequestId
      });

      const correction = await loadLatestCorrection(transaction, worker.accountId);
      if (!correction) {
        throw new Error("Worker identity correction request did not persist.");
      }
      return correction;
    });
  }

  async submitOwn(
    principal: AuthorizationPrincipal,
    expectedLockVersionInput: number
  ): Promise<WorkerIdentityCorrectionRecord> {
    const expectedLockVersion = normalizeWorkerIdentityLockVersion(
      expectedLockVersionInput
    );
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const worker = await assertLiveWorker(transaction, principal);
      const current = await loadCurrentContext(transaction, worker.accountId, true);
      if (!current) throw new WorkerIdentityNotFoundError();
      if (safeNumber(current.lock_version, "lock version") !== expectedLockVersion) {
        throw new WorkerIdentityConflictError();
      }
      if (
        current.lifecycle_status !== "correction_pending" ||
        current.version_kind !== "correction"
      ) {
        throw new WorkerIdentityCorrectionConflictError(
          "No editable Worker identity correction is current."
        );
      }

      const correction = await loadLatestCorrection(transaction, worker.accountId);
      if (
        !correction ||
        correction.correctionVersionId !== current.identity_version_id ||
        correction.decision !== null
      ) {
        throw new WorkerIdentityCorrectionConflictError();
      }
      if (current.version_status === "submitted") return correction;
      if (current.version_status !== "draft") {
        throw new WorkerIdentityCorrectionConflictError();
      }

      const submitted = await transaction.query<{ identity_version_id: string }>(
        `UPDATE worker_identity_versions
         SET version_status = 'submitted',
             submitted_at = CURRENT_TIMESTAMP
         WHERE identity_version_id = $1
           AND identity_id = $2
           AND version_status = 'draft'
           AND submitted_at IS NULL
         RETURNING identity_version_id`,
        [current.identity_version_id, current.identity_id]
      );
      if (submitted.rows.length !== 1) {
        throw new WorkerIdentityConflictError(
          "The correction version changed before submission completed."
        );
      }

      await appendWorkerCorrectionAudit(transaction, worker, current.identity_id, {
        eventType: "correction_version_submitted",
        lifecycleStatus: "correction_pending",
        correctionRequestId: correction.correctionRequestId,
        correctionVersionNumber: safeNumber(current.version_number, "version number"),
        fromVersionStatus: "draft",
        toVersionStatus: "submitted"
      });

      const after = await loadLatestCorrection(transaction, worker.accountId);
      if (!after || after.submittedAt === null) {
        throw new Error("Worker identity correction submission did not persist.");
      }
      return after;
    });
  }

  async decide(
    authority: TrustedWorkerIdentityCorrectionAuthority,
    input: Readonly<{
      correctionRequestId: string;
      decision: WorkerIdentityCorrectionDecision;
      reasonCode: string;
    }>
  ): Promise<WorkerIdentityCorrectionRecord> {
    assertTrustedWorkerIdentityCorrectionAuthority(authority);
    const correctionRequestId = normalizeWorkerIdentityCorrectionRequestReference(
      input.correctionRequestId
    );
    if (!isWorkerIdentityCorrectionDecision(input.decision)) {
      throw new WorkerIdentityCorrectionConflictError(
        "Worker identity correction decision is invalid."
      );
    }
    const reasonCode = normalizeWorkerIdentityCorrectionReasonCode(input.reasonCode);
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const requestResult = await transaction.query<
        CorrectionRow & {
          lifecycle_status: string;
          current_version_number: number | string;
          lock_version: number | string;
          correction_version_number: number | string;
          correction_version_status: string;
          parent_version_number: number | string;
        }
      >(
        `SELECT
           requests.correction_request_id,
           requests.identity_id,
           requests.correction_version_id,
           requests.parent_version_id,
           requests.worker_account_id,
           requests.reason,
           requests.requested_at,
           correction.submitted_at,
           existing.decision,
           existing.reason_code,
           existing.decided_at,
           identities.lifecycle_status,
           identities.current_version_number,
           identities.lock_version,
           correction.version_number AS correction_version_number,
           correction.version_status AS correction_version_status,
           parent.version_number AS parent_version_number
         FROM worker_identity_correction_requests AS requests
         JOIN worker_identities AS identities
           ON identities.identity_id = requests.identity_id
         JOIN worker_identity_versions AS correction
           ON correction.identity_version_id = requests.correction_version_id
         JOIN worker_identity_versions AS parent
           ON parent.identity_version_id = requests.parent_version_id
         LEFT JOIN worker_identity_correction_decisions AS existing
           ON existing.correction_request_id = requests.correction_request_id
         WHERE requests.correction_request_id = $1
         FOR UPDATE OF identities, correction, parent`,
        [correctionRequestId]
      );
      if (requestResult.rows.length !== 1) {
        throw new WorkerIdentityCorrectionNotFoundError();
      }
      const row = requestResult.rows[0];
      if (row.decision !== null) {
        if (row.decision === input.decision && row.reason_code === reasonCode) {
          return correctionFromRow(row);
        }
        throw new WorkerIdentityCorrectionConflictError(
          "The Worker identity correction already has a different decision."
        );
      }

      const correctionVersionNumber = safeNumber(
        row.correction_version_number,
        "correction version number"
      );
      const parentVersionNumber = safeNumber(
        row.parent_version_number,
        "parent version number"
      );
      if (
        row.lifecycle_status !== "correction_pending" ||
        safeNumber(row.current_version_number, "current version number") !==
          correctionVersionNumber ||
        row.correction_version_status !== "submitted" ||
        row.submitted_at === null ||
        parentVersionNumber >= correctionVersionNumber
      ) {
        throw new WorkerIdentityCorrectionConflictError(
          "The correction is not ready for an identity-assurance decision."
        );
      }

      const insertedDecision = await transaction.query<{ correction_decision_id: string }>(
        `INSERT INTO worker_identity_correction_decisions (
           correction_decision_id, correction_request_id,
           decision, reason_code, decided_by_component
         ) VALUES ($1, $2, $3, $4, 'identity-assurance')
         ON CONFLICT (correction_request_id) DO NOTHING
         RETURNING correction_decision_id`,
        [
          createWorkerIdentityCorrectionDecisionId(),
          correctionRequestId,
          input.decision,
          reasonCode
        ]
      );
      if (insertedDecision.rows.length !== 1) {
        throw new WorkerIdentityCorrectionConflictError();
      }

      const activeVersionNumber =
        input.decision === "accepted"
          ? correctionVersionNumber
          : parentVersionNumber;
      const updated = await transaction.query<{ identity_id: string }>(
        `UPDATE worker_identities
         SET lifecycle_status = 'verified',
             current_version_number = $1,
             lock_version = lock_version + 1
         WHERE identity_id = $2
           AND worker_account_id = $3
           AND lifecycle_status = 'correction_pending'
           AND current_version_number = $4
           AND lock_version = $5
         RETURNING identity_id`,
        [
          activeVersionNumber,
          row.identity_id,
          row.worker_account_id,
          correctionVersionNumber,
          safeNumber(row.lock_version, "lock version")
        ]
      );
      if (updated.rows.length !== 1) {
        throw new WorkerIdentityCorrectionConflictError();
      }

      await appendSystemCorrectionAudit(transaction, row.identity_id, {
        eventType: "correction_decided",
        fromStatus: "correction_pending",
        toStatus: "verified",
        correctionRequestId,
        correctionDecision: input.decision,
        correctionVersionNumber,
        activeVersionNumber,
        decisionReasonCode: reasonCode
      });

      const finalResult = await transaction.query<CorrectionRow>(
        `SELECT
           requests.correction_request_id,
           requests.identity_id,
           requests.correction_version_id,
           requests.parent_version_id,
           requests.worker_account_id,
           requests.reason,
           requests.requested_at,
           correction.submitted_at,
           decisions.decision,
           decisions.reason_code,
           decisions.decided_at
         FROM worker_identity_correction_requests AS requests
         JOIN worker_identity_versions AS correction
           ON correction.identity_version_id = requests.correction_version_id
         JOIN worker_identity_correction_decisions AS decisions
           ON decisions.correction_request_id = requests.correction_request_id
         WHERE requests.correction_request_id = $1`,
        [correctionRequestId]
      );
      if (finalResult.rows.length !== 1) {
        throw new Error("Worker identity correction decision did not persist.");
      }
      return correctionFromRow(finalResult.rows[0]);
    });
  }
}

let repository: WorkerIdentityCorrectionRepository | null = null;

export function getWorkerIdentityCorrectionRepository(): WorkerIdentityCorrectionRepository {
  repository ??= new DatabaseWorkerIdentityCorrectionRepository();
  return repository;
}
