import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  AUDIT_APPEND_SQL
} from "../audit/audit-repository";
import {
  createAuditEventId,
  normalizeAuditMetadata,
  type AuditAction
} from "../audit/audit-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  WORKER_IDENTITY_SCHEMA_VERSION,
  WorkerIdentityAccessDeniedError,
  WorkerIdentityConflictError,
  WorkerIdentityNotFoundError,
  assertWorkerIdentityPrincipal,
  assertWorkerSelfTransition,
  createWorkerIdentityId,
  createWorkerIdentityVersionId,
  isWorkerIdentityStatus,
  isWorkerIdentityVersionKind,
  isWorkerIdentityVersionStatus,
  normalizeWorkerIdentityLockVersion,
  normalizeWorkerIdentityReference,
  normalizeWorkerIdentityVersionNumber,
  normalizeWorkerIdentityVersionReference,
  type WorkerIdentityRecord,
  type WorkerIdentitySnapshot,
  type WorkerIdentityStatus,
  type WorkerIdentityVersionRecord
} from "./worker-identity-domain";

export const WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL = `
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

const WORKER_IDENTITY_SNAPSHOT_SQL = `
SELECT
  identities.identity_id,
  identities.worker_account_id,
  identities.schema_version,
  identities.lifecycle_status,
  identities.current_version_number,
  identities.lock_version,
  identities.created_at,
  identities.updated_at,
  versions.identity_version_id,
  versions.parent_version_id,
  versions.version_kind,
  versions.version_status,
  versions.created_by_account_id,
  versions.created_at AS version_created_at,
  versions.submitted_at
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
WHERE identities.worker_account_id = $1`;

const WORKER_IDENTITY_SNAPSHOT_FOR_UPDATE_SQL = `${WORKER_IDENTITY_SNAPSHOT_SQL}
FOR UPDATE OF identities, versions`;

type WorkerIdentitySnapshotRow = {
  identity_id: string;
  worker_account_id: string;
  schema_version: number | string;
  lifecycle_status: string;
  current_version_number: number | string;
  lock_version: number | string;
  created_at: string | Date;
  updated_at: string | Date;
  identity_version_id: string;
  parent_version_id: string | null;
  version_kind: string;
  version_status: string;
  created_by_account_id: string;
  version_created_at: string | Date;
  submitted_at: string | Date | null;
};

function timestamp(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function optionalTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function snapshotFromRow(row: WorkerIdentitySnapshotRow): WorkerIdentitySnapshot {
  const schemaVersion = Number(row.schema_version);
  const currentVersionNumber = normalizeWorkerIdentityVersionNumber(
    Number(row.current_version_number)
  );
  const lockVersion = normalizeWorkerIdentityLockVersion(Number(row.lock_version));
  if (
    schemaVersion !== WORKER_IDENTITY_SCHEMA_VERSION ||
    !isWorkerIdentityStatus(row.lifecycle_status) ||
    !isWorkerIdentityVersionKind(row.version_kind) ||
    !isWorkerIdentityVersionStatus(row.version_status)
  ) {
    throw new Error("Stored Worker identity vocabulary is invalid.");
  }

  const identityId = normalizeWorkerIdentityReference(row.identity_id);
  const identityVersionId = normalizeWorkerIdentityVersionReference(
    row.identity_version_id
  );
  const parentVersionId = row.parent_version_id
    ? normalizeWorkerIdentityVersionReference(row.parent_version_id)
    : null;

  const identity: WorkerIdentityRecord = Object.freeze({
    identityId,
    workerAccountId: row.worker_account_id,
    schemaVersion: WORKER_IDENTITY_SCHEMA_VERSION,
    lifecycleStatus: row.lifecycle_status,
    currentVersionNumber,
    lockVersion,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  });
  const currentVersion: WorkerIdentityVersionRecord = Object.freeze({
    identityVersionId,
    identityId,
    versionNumber: currentVersionNumber,
    parentVersionId,
    versionKind: row.version_kind,
    versionStatus: row.version_status,
    createdByAccountId: row.created_by_account_id,
    createdAt: timestamp(row.version_created_at),
    submittedAt: optionalTimestamp(row.submitted_at)
  });
  return Object.freeze({ identity, currentVersion });
}

async function assertLiveWorkerAuthority(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<void> {
  const worker = assertWorkerIdentityPrincipal(principal);
  const result = await database.query<{ session_id: string }>(
    WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL,
    [worker.sessionId, worker.accountId]
  );
  if (result.rows.length !== 1) {
    throw new WorkerIdentityAccessDeniedError();
  }
}

async function loadSnapshot(
  database: DatabaseClient,
  workerAccountId: string,
  forUpdate: boolean
): Promise<WorkerIdentitySnapshot | null> {
  const result = await database.query<WorkerIdentitySnapshotRow>(
    forUpdate
      ? WORKER_IDENTITY_SNAPSHOT_FOR_UPDATE_SQL
      : WORKER_IDENTITY_SNAPSHOT_SQL,
    [workerAccountId]
  );
  if (result.rows.length > 1) {
    throw new Error("Worker identity ownership uniqueness is corrupted.");
  }
  return result.rows[0] ? snapshotFromRow(result.rows[0]) : null;
}

async function appendIdentityAudit(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  input: Readonly<{
    action: Extract<AuditAction, "worker_identity.created" | "worker_identity.status.changed">;
    identityId: string;
    metadata: Readonly<Record<string, unknown>>;
  }>
): Promise<void> {
  const metadata = normalizeAuditMetadata(input.metadata);
  await database.query(
    AUDIT_APPEND_SQL,
    [
      createAuditEventId(),
      principal.accountId,
      "worker",
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

export interface WorkerIdentityRepository {
  loadOwn(principal: AuthorizationPrincipal): Promise<WorkerIdentitySnapshot | null>;
  ensureOwnDraft(principal: AuthorizationPrincipal): Promise<WorkerIdentitySnapshot>;
  submitOwn(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentitySnapshot>;
  withdrawOwn(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentitySnapshot>;
}

export class DatabaseWorkerIdentityRepository implements WorkerIdentityRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private async client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async loadOwn(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentitySnapshot | null> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLiveWorkerAuthority(transaction, principal);
      return loadSnapshot(transaction, principal.accountId, false);
    });
  }

  async ensureOwnDraft(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentitySnapshot> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLiveWorkerAuthority(transaction, worker);

      const existing = await loadSnapshot(transaction, worker.accountId, true);
      if (existing) return existing;

      const identityId = createWorkerIdentityId();
      const identityVersionId = createWorkerIdentityVersionId();
      const inserted = await transaction.query<{ identity_id: string }>(
        `INSERT INTO worker_identities (
           identity_id, worker_account_id, schema_version,
           lifecycle_status, current_version_number, lock_version
         ) VALUES ($1, $2, 1, 'draft', 1, 1)
         ON CONFLICT (worker_account_id) DO NOTHING
         RETURNING identity_id`,
        [identityId, worker.accountId]
      );

      if (inserted.rows.length === 1) {
        await transaction.query(
          `INSERT INTO worker_identity_versions (
             identity_version_id, identity_id, version_number,
             parent_version_id, version_kind, version_status,
             created_by_account_id
           ) VALUES ($1, $2, 1, NULL, 'initial', 'draft', $3)`,
          [identityVersionId, identityId, worker.accountId]
        );
        await appendIdentityAudit(transaction, worker, {
          action: "worker_identity.created",
          identityId,
          metadata: { versionNumber: 1 }
        });
      }

      const snapshot = await loadSnapshot(transaction, worker.accountId, true);
      if (!snapshot) {
        throw new Error("Worker identity creation did not produce a durable aggregate.");
      }
      return snapshot;
    });
  }

  async submitOwn(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentitySnapshot> {
    return this.transitionOwn(principal, expectedLockVersion, "submitted");
  }

  async withdrawOwn(
    principal: AuthorizationPrincipal,
    expectedLockVersion: number
  ): Promise<WorkerIdentitySnapshot> {
    return this.transitionOwn(principal, expectedLockVersion, "withdrawn");
  }

  private async transitionOwn(
    principal: AuthorizationPrincipal,
    expectedLockVersionInput: number,
    toStatus: Extract<WorkerIdentityStatus, "submitted" | "withdrawn">
  ): Promise<WorkerIdentitySnapshot> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const expectedLockVersion = normalizeWorkerIdentityLockVersion(
      expectedLockVersionInput
    );
    const database = await this.client();

    return database.transaction(async (transaction) => {
      await assertLiveWorkerAuthority(transaction, worker);
      const before = await loadSnapshot(transaction, worker.accountId, true);
      if (!before) throw new WorkerIdentityNotFoundError();
      if (before.identity.lockVersion !== expectedLockVersion) {
        throw new WorkerIdentityConflictError();
      }
      assertWorkerSelfTransition(before.identity.lifecycleStatus, toStatus);

      if (toStatus === "submitted") {
        const submitted = await transaction.query<{ identity_version_id: string }>(
          `UPDATE worker_identity_versions
           SET version_status = 'submitted',
               submitted_at = CURRENT_TIMESTAMP
           WHERE identity_version_id = $1
             AND identity_id = $2
             AND version_status = 'draft'
             AND submitted_at IS NULL
           RETURNING identity_version_id`,
          [
            before.currentVersion.identityVersionId,
            before.identity.identityId
          ]
        );
        if (submitted.rows.length !== 1) {
          throw new WorkerIdentityConflictError(
            "The current Worker identity version is no longer a draft."
          );
        }
      }

      const updated = await transaction.query<{ identity_id: string }>(
        `UPDATE worker_identities
         SET lifecycle_status = $1,
             lock_version = lock_version + 1
         WHERE identity_id = $2
           AND worker_account_id = $3
           AND lock_version = $4
           AND lifecycle_status = $5
         RETURNING identity_id`,
        [
          toStatus,
          before.identity.identityId,
          worker.accountId,
          expectedLockVersion,
          before.identity.lifecycleStatus
        ]
      );
      if (updated.rows.length !== 1) {
        throw new WorkerIdentityConflictError();
      }

      await appendIdentityAudit(transaction, worker, {
        action: "worker_identity.status.changed",
        identityId: before.identity.identityId,
        metadata: {
          fromStatus: before.identity.lifecycleStatus,
          toStatus,
          versionNumber: before.identity.currentVersionNumber
        }
      });

      const after = await loadSnapshot(transaction, worker.accountId, false);
      if (!after) throw new WorkerIdentityNotFoundError();
      return after;
    });
  }
}

let repository: WorkerIdentityRepository | null = null;

export function getWorkerIdentityRepository(): WorkerIdentityRepository {
  repository ??= new DatabaseWorkerIdentityRepository();
  return repository;
}
