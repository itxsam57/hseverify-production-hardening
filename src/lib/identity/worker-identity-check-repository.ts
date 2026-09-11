import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  bindTrustedAuditActor,
  bindTrustedSystemAuditActor
} from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  assertTrustedOutboxLease,
  normalizeOutboxPayload,
  type OutboxJobRecord,
  type TrustedOutboxLease
} from "../outbox/outbox-domain";
import {
  DatabaseOutboxRepository,
  type OutboxRepository
} from "../outbox/outbox-repository";
import {
  WorkerIdentityAccessDeniedError,
  WorkerIdentityConflictError,
  WorkerIdentityNotFoundError,
  assertWorkerIdentityPrincipal
} from "./worker-identity-domain";
import {
  WorkerIdentityCheckContractError,
  WorkerIdentityCheckStaleVersionError,
  createWorkerIdentityCheckRunId,
  isWorkerIdentityAutomatedCheckOutcome,
  isWorkerIdentityAutomatedCheckType,
  isWorkerIdentityCheckRunStatus,
  normalizeWorkerIdentityAutomatedCheckBatch,
  type WorkerIdentityAutomatedCheckBatch,
  type WorkerIdentityAutomatedCheckRequest,
  type WorkerIdentityCheckRunRecord
} from "./worker-identity-check-domain";

export const WORKER_IDENTITY_CHECK_LIVE_WORKER_SQL = `
SELECT sessions.session_id
FROM auth_sessions AS sessions
JOIN auth_accounts AS accounts
  ON accounts.account_id = sessions.account_id
JOIN auth_account_roles AS roles
  ON roles.account_id = sessions.account_id
 AND roles.role = sessions.active_role
WHERE sessions.session_id = $1
  AND sessions.account_id = $2
  AND sessions.active_role = 'worker'
  AND accounts.account_status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > CURRENT_TIMESTAMP
FOR UPDATE OF sessions, accounts`;

const CURRENT_SUBMITTED_VERSION_SQL = `
SELECT
  identities.identity_id,
  identities.worker_account_id,
  identities.lifecycle_status,
  identities.lock_version,
  versions.identity_version_id,
  versions.version_status
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
WHERE identities.worker_account_id = $1`;

const CURRENT_VERSION_BY_REFS_FOR_UPDATE_SQL = `
SELECT
  identities.identity_id,
  identities.worker_account_id,
  identities.lifecycle_status,
  identities.lock_version,
  versions.identity_version_id,
  versions.version_status
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
WHERE identities.identity_id = $1
  AND versions.identity_version_id = $2
FOR UPDATE OF identities, versions`;

const LEASED_JOB_GUARD_SQL = `
SELECT job_id
FROM platform_outbox_jobs
WHERE job_id = $1
  AND job_type = 'worker_identity.automated_checks'
  AND status = 'leased'
  AND lease_id = $2
  AND worker_id = $3
  AND lease_expires_at > CURRENT_TIMESTAMP
  AND payload ->> 'identityRef' = $4
  AND payload ->> 'versionRef' = $5
FOR UPDATE`;

const ACTIVE_EVIDENCE_SQL = `
SELECT purpose, secure_file_id, document_type
FROM worker_identity_evidence_bindings
WHERE identity_version_id = $1
  AND worker_account_id = $2
  AND binding_status = 'active'
  AND purpose IN ('identity_document', 'profile_photo', 'selfie')
ORDER BY purpose`;

const FIND_RUN_BY_VERSION_SQL = `
SELECT *
FROM worker_identity_check_runs
WHERE identity_version_id = $1`;

const FIND_RUN_BY_JOB_SQL = `
SELECT *
FROM worker_identity_check_runs
WHERE job_id = $1`;

const FIND_RESULTS_SQL = `
SELECT check_type, outcome, result_code
FROM worker_identity_check_results
WHERE run_id = $1
ORDER BY check_type`;

type IdentityRow = {
  identity_id: string;
  worker_account_id: string;
  lifecycle_status: string;
  lock_version: number | string;
  identity_version_id: string;
  version_status: string;
};

type EvidenceRow = {
  purpose: string;
  secure_file_id: string;
  document_type: string | null;
};

type RunRow = {
  run_id: string;
  identity_id: string;
  identity_version_id: string;
  worker_account_id: string;
  job_id: string;
  run_status: string;
  adapter_key: string | null;
  failure_code: string | null;
  created_at: string | Date;
  started_at: string | Date;
  completed_at: string | Date | null;
};

type ResultRow = {
  check_type: string;
  outcome: string;
  result_code: string;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function optionalTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function runFromRow(row: RunRow): WorkerIdentityCheckRunRecord {
  if (
    !isWorkerIdentityCheckRunStatus(row.run_status) ||
    (row.adapter_key !== null &&
      row.adapter_key !== "deterministic_local_test" &&
      row.adapter_key !== "unconfigured")
  ) {
    throw new WorkerIdentityCheckContractError("Stored automated-check run vocabulary is invalid.");
  }
  return Object.freeze({
    runId: row.run_id,
    identityId: row.identity_id,
    identityVersionId: row.identity_version_id,
    workerAccountId: row.worker_account_id,
    jobId: row.job_id,
    runStatus: row.run_status,
    adapterKey: row.adapter_key,
    failureCode: row.failure_code,
    createdAt: timestamp(row.created_at),
    startedAt: timestamp(row.started_at),
    completedAt: optionalTimestamp(row.completed_at)
  });
}

async function assertLiveWorker(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<void> {
  const worker = assertWorkerIdentityPrincipal(principal);
  const result = await database.query<{ session_id: string }>(
    WORKER_IDENTITY_CHECK_LIVE_WORKER_SQL,
    [worker.sessionId, worker.accountId]
  );
  if (result.rows.length !== 1) throw new WorkerIdentityAccessDeniedError();
}

function requestFromEvidence(
  identity: IdentityRow,
  evidenceRows: readonly EvidenceRow[]
): WorkerIdentityAutomatedCheckRequest {
  const byPurpose = new Map(evidenceRows.map((row) => [row.purpose, row]));
  const document = byPurpose.get("identity_document");
  const photo = byPurpose.get("profile_photo");
  const selfie = byPurpose.get("selfie");
  if (
    !document || !photo || !selfie ||
    !document.document_type ||
    !/^(passport|national_id|residence_permit)$/.test(document.document_type)
  ) {
    throw new WorkerIdentityCheckContractError("Submitted identity evidence set is incomplete.");
  }
  return Object.freeze({
    identityId: identity.identity_id,
    identityVersionId: identity.identity_version_id,
    documentType: document.document_type as WorkerIdentityAutomatedCheckRequest["documentType"],
    documentEvidenceRef: document.secure_file_id,
    profilePhotoEvidenceRef: photo.secure_file_id,
    selfieEvidenceRef: selfie.secure_file_id
  });
}

async function appendSystemStatusAudit(
  database: DatabaseClient,
  identityId: string,
  fromStatus: string,
  toStatus: string,
  runId: string
): Promise<void> {
  const audit = new DatabaseAuditRepository(Promise.resolve(database));
  await audit.append(bindTrustedSystemAuditActor("outbox-worker"), {
    action: "worker_identity.status.changed",
    outcome: "succeeded",
    target: { type: "worker_identity", reference: identityId },
    metadata: { fromStatus, toStatus, runId }
  });
}

export type WorkerIdentityCheckBeginResult =
  | Readonly<{
      kind: "ready";
      run: WorkerIdentityCheckRunRecord;
      request: WorkerIdentityAutomatedCheckRequest;
    }>
  | Readonly<{ kind: "already_completed"; run: WorkerIdentityCheckRunRecord }>
  | Readonly<{ kind: "stale" }>;

export type WorkerIdentityCheckProjection = Readonly<{
  run: WorkerIdentityCheckRunRecord;
  results: readonly Readonly<{
    checkType: "document_consistency" | "face_comparison" | "liveness";
    outcome: "passed" | "needs_review";
    resultCode: string;
  }>[];
}>;

export interface WorkerIdentityCheckRepository {
  scheduleOwn(principal: AuthorizationPrincipal): Promise<OutboxJobRecord>;
  beginLeasedRun(
    job: OutboxJobRecord,
    lease: TrustedOutboxLease
  ): Promise<WorkerIdentityCheckBeginResult>;
  completeLeasedRun(
    job: OutboxJobRecord,
    lease: TrustedOutboxLease,
    batch: WorkerIdentityAutomatedCheckBatch
  ): Promise<WorkerIdentityCheckRunRecord>;
  failProviderUnavailable(
    job: OutboxJobRecord,
    lease: TrustedOutboxLease
  ): Promise<WorkerIdentityCheckRunRecord>;
  loadOwn(principal: AuthorizationPrincipal): Promise<WorkerIdentityCheckProjection | null>;
}

export class DatabaseWorkerIdentityCheckRepository
  implements WorkerIdentityCheckRepository
{
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient(),
    private readonly outbox: OutboxRepository = new DatabaseOutboxRepository(
      this.clientPromise
    )
  ) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async scheduleOwn(principal: AuthorizationPrincipal): Promise<OutboxJobRecord> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLiveWorker(transaction, worker);
      const current = await transaction.query<IdentityRow>(
        CURRENT_SUBMITTED_VERSION_SQL,
        [worker.accountId]
      );
      const row = current.rows[0];
      if (!row) throw new WorkerIdentityNotFoundError();
      if (row.lifecycle_status !== "submitted" || row.version_status !== "submitted") {
        throw new WorkerIdentityConflictError(
          "Automated checks can be scheduled only for the current submitted Worker identity."
        );
      }
      const actor = bindTrustedAuditActor(worker);
      return this.outbox.enqueueInTransaction(transaction, actor, {
        jobType: "worker_identity.automated_checks",
        businessKey: `identity-checks:${row.identity_version_id}`,
        payload: {
          identityRef: row.identity_id,
          versionRef: row.identity_version_id
        }
      });
    });
  }

  async beginLeasedRun(
    job: OutboxJobRecord,
    leaseInput: TrustedOutboxLease
  ): Promise<WorkerIdentityCheckBeginResult> {
    const lease = assertTrustedOutboxLease(leaseInput);
    if (job.jobType !== "worker_identity.automated_checks" || job.jobId !== lease.jobId) {
      throw new WorkerIdentityCheckContractError("Automated-check job/lease binding is invalid.");
    }
    const payload = normalizeOutboxPayload("worker_identity.automated_checks", job.payload);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const liveLease = await transaction.query<{ job_id: string }>(
        LEASED_JOB_GUARD_SQL,
        [job.jobId, lease.leaseId, lease.workerId, payload.identityRef, payload.versionRef]
      );
      if (liveLease.rows.length !== 1) {
        throw new WorkerIdentityCheckContractError("Automated-check lease is no longer live.");
      }

      const identityResult = await transaction.query<IdentityRow>(
        CURRENT_VERSION_BY_REFS_FOR_UPDATE_SQL,
        [payload.identityRef, payload.versionRef]
      );
      const identity = identityResult.rows[0];
      if (
        !identity ||
        identity.version_status !== "submitted" ||
        (identity.lifecycle_status !== "submitted" &&
          identity.lifecycle_status !== "automated_checks")
      ) {
        return Object.freeze({ kind: "stale" as const });
      }

      const existingResult = await transaction.query<RunRow>(
        FIND_RUN_BY_VERSION_SQL,
        [payload.versionRef]
      );
      if (existingResult.rows.length > 1) {
        throw new WorkerIdentityCheckContractError("Automated-check run uniqueness is corrupted.");
      }
      let run: WorkerIdentityCheckRunRecord;
      if (existingResult.rows[0]) {
        run = runFromRow(existingResult.rows[0]);
        if (run.jobId !== job.jobId) {
          throw new WorkerIdentityCheckStaleVersionError();
        }
        if (run.runStatus === "completed") {
          return Object.freeze({ kind: "already_completed" as const, run });
        }
        if (run.runStatus !== "processing") {
          return Object.freeze({ kind: "stale" as const });
        }
      } else {
        const inserted = await transaction.query<RunRow>(
          `INSERT INTO worker_identity_check_runs (
             run_id, identity_id, identity_version_id, worker_account_id,
             job_id, run_status
           ) VALUES ($1, $2, $3, $4, $5, 'processing')
           RETURNING *`,
          [
            createWorkerIdentityCheckRunId(),
            identity.identity_id,
            identity.identity_version_id,
            identity.worker_account_id,
            job.jobId
          ]
        );
        if (inserted.rows.length !== 1) {
          throw new WorkerIdentityCheckContractError("Automated-check run was not created.");
        }
        run = runFromRow(inserted.rows[0]);
      }

      if (identity.lifecycle_status === "submitted") {
        const transitioned = await transaction.query<{ identity_id: string }>(
          `UPDATE worker_identities
           SET lifecycle_status = 'automated_checks',
               lock_version = lock_version + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE identity_id = $1
             AND worker_account_id = $2
             AND current_version_number = (
               SELECT version_number FROM worker_identity_versions
               WHERE identity_version_id = $3
             )
             AND lifecycle_status = 'submitted'
           RETURNING identity_id`,
          [identity.identity_id, identity.worker_account_id, identity.identity_version_id]
        );
        if (transitioned.rows.length !== 1) {
          throw new WorkerIdentityCheckStaleVersionError();
        }
        await appendSystemStatusAudit(
          transaction,
          identity.identity_id,
          "submitted",
          "automated_checks",
          run.runId
        );
      }

      const evidence = await transaction.query<EvidenceRow>(ACTIVE_EVIDENCE_SQL, [
        identity.identity_version_id,
        identity.worker_account_id
      ]);
      return Object.freeze({
        kind: "ready" as const,
        run,
        request: requestFromEvidence(identity, evidence.rows)
      });
    });
  }

  async completeLeasedRun(
    job: OutboxJobRecord,
    leaseInput: TrustedOutboxLease,
    batchInput: WorkerIdentityAutomatedCheckBatch
  ): Promise<WorkerIdentityCheckRunRecord> {
    const lease = assertTrustedOutboxLease(leaseInput);
    const payload = normalizeOutboxPayload("worker_identity.automated_checks", job.payload);
    const batch = normalizeWorkerIdentityAutomatedCheckBatch(batchInput);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const liveLease = await transaction.query<{ job_id: string }>(
        LEASED_JOB_GUARD_SQL,
        [job.jobId, lease.leaseId, lease.workerId, payload.identityRef, payload.versionRef]
      );
      if (liveLease.rows.length !== 1) {
        throw new WorkerIdentityCheckContractError("Automated-check lease is no longer live.");
      }
      const runResult = await transaction.query<RunRow>(FIND_RUN_BY_JOB_SQL, [job.jobId]);
      const row = runResult.rows[0];
      if (!row) throw new WorkerIdentityCheckContractError("Automated-check run is missing.");
      const run = runFromRow(row);
      if (run.runStatus === "completed") return run;
      if (run.runStatus !== "processing") {
        throw new WorkerIdentityCheckStaleVersionError();
      }

      const identityResult = await transaction.query<IdentityRow>(
        CURRENT_VERSION_BY_REFS_FOR_UPDATE_SQL,
        [payload.identityRef, payload.versionRef]
      );
      const identity = identityResult.rows[0];
      if (
        !identity ||
        identity.lifecycle_status !== "automated_checks" ||
        identity.version_status !== "submitted"
      ) {
        await transaction.query(
          `UPDATE worker_identity_check_runs
           SET run_status = 'stale', adapter_key = $2, failure_code = 'stale_identity_version'
           WHERE run_id = $1 AND run_status = 'processing'`,
          [run.runId, batch.adapterKey]
        );
        throw new WorkerIdentityCheckStaleVersionError();
      }

      for (const result of batch.results) {
        await transaction.query(
          `INSERT INTO worker_identity_check_results (
             run_id, check_type, outcome, result_code
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (run_id, check_type) DO NOTHING`,
          [run.runId, result.checkType, result.outcome, result.resultCode]
        );
      }
      const storedResults = await transaction.query<ResultRow>(FIND_RESULTS_SQL, [run.runId]);
      if (storedResults.rows.length !== 3) {
        throw new WorkerIdentityCheckContractError("Automated-check result set is incomplete.");
      }
      for (const stored of storedResults.rows) {
        if (
          !isWorkerIdentityAutomatedCheckType(stored.check_type) ||
          !isWorkerIdentityAutomatedCheckOutcome(stored.outcome)
        ) {
          throw new WorkerIdentityCheckContractError("Stored automated-check result vocabulary is invalid.");
        }
      }

      const completed = await transaction.query<RunRow>(
        `UPDATE worker_identity_check_runs
         SET run_status = 'completed', adapter_key = $2
         WHERE run_id = $1 AND run_status = 'processing'
         RETURNING *`,
        [run.runId, batch.adapterKey]
      );
      if (completed.rows.length !== 1) {
        throw new WorkerIdentityCheckContractError("Automated-check run completion conflicted.");
      }

      const transitioned = await transaction.query<{ identity_id: string }>(
        `UPDATE worker_identities
         SET lifecycle_status = 'manual_review',
             lock_version = lock_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE identity_id = $1
           AND worker_account_id = $2
           AND lifecycle_status = 'automated_checks'
           AND current_version_number = (
             SELECT version_number FROM worker_identity_versions
             WHERE identity_version_id = $3
           )
         RETURNING identity_id`,
        [identity.identity_id, identity.worker_account_id, identity.identity_version_id]
      );
      if (transitioned.rows.length !== 1) {
        throw new WorkerIdentityCheckStaleVersionError();
      }
      await appendSystemStatusAudit(
        transaction,
        identity.identity_id,
        "automated_checks",
        "manual_review",
        run.runId
      );
      return runFromRow(completed.rows[0]);
    });
  }

  async failProviderUnavailable(
    job: OutboxJobRecord,
    leaseInput: TrustedOutboxLease
  ): Promise<WorkerIdentityCheckRunRecord> {
    const lease = assertTrustedOutboxLease(leaseInput);
    const payload = normalizeOutboxPayload("worker_identity.automated_checks", job.payload);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const liveLease = await transaction.query<{ job_id: string }>(
        LEASED_JOB_GUARD_SQL,
        [job.jobId, lease.leaseId, lease.workerId, payload.identityRef, payload.versionRef]
      );
      if (liveLease.rows.length !== 1) {
        throw new WorkerIdentityCheckContractError("Automated-check lease is no longer live.");
      }
      const updated = await transaction.query<RunRow>(
        `UPDATE worker_identity_check_runs
         SET run_status = 'provider_unavailable',
             adapter_key = 'unconfigured',
             failure_code = 'provider_not_configured'
         WHERE job_id = $1 AND run_status = 'processing'
         RETURNING *`,
        [job.jobId]
      );
      if (updated.rows.length !== 1) {
        const existing = await transaction.query<RunRow>(FIND_RUN_BY_JOB_SQL, [job.jobId]);
        if (!existing.rows[0]) {
          throw new WorkerIdentityCheckContractError("Automated-check run is missing.");
        }
        return runFromRow(existing.rows[0]);
      }
      return runFromRow(updated.rows[0]);
    });
  }

  async loadOwn(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityCheckProjection | null> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLiveWorker(transaction, worker);
      const current = await transaction.query<IdentityRow>(CURRENT_SUBMITTED_VERSION_SQL, [
        worker.accountId
      ]);
      const identity = current.rows[0];
      if (!identity) return null;
      const runResult = await transaction.query<RunRow>(FIND_RUN_BY_VERSION_SQL, [
        identity.identity_version_id
      ]);
      if (!runResult.rows[0]) return null;
      const run = runFromRow(runResult.rows[0]);
      const resultRows = await transaction.query<ResultRow>(FIND_RESULTS_SQL, [run.runId]);
      const results = resultRows.rows.map((row) => {
        if (
          !isWorkerIdentityAutomatedCheckType(row.check_type) ||
          !isWorkerIdentityAutomatedCheckOutcome(row.outcome)
        ) {
          throw new WorkerIdentityCheckContractError("Stored automated-check result vocabulary is invalid.");
        }
        return Object.freeze({
          checkType: row.check_type,
          outcome: row.outcome,
          resultCode: row.result_code
        });
      });
      return Object.freeze({ run, results: Object.freeze(results) });
    });
  }
}

let repository: WorkerIdentityCheckRepository | null = null;
export function getWorkerIdentityCheckRepository(): WorkerIdentityCheckRepository {
  repository ??= new DatabaseWorkerIdentityCheckRepository();
  return repository;
}
