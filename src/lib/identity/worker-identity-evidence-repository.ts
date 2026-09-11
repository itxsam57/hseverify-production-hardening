import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  WorkerIdentityAccessDeniedError,
  WorkerIdentityConflictError,
  WorkerIdentityNotFoundError,
  assertWorkerIdentityPrincipal
} from "./worker-identity-domain";
import {
  WorkerIdentityEvidenceConflictError,
  WorkerIdentityEvidenceUnavailableError,
  createWorkerIdentityEvidenceBindingId,
  isWorkerIdentityDocumentType,
  isWorkerIdentityEvidencePurpose,
  normalizeWorkerIdentityEvidenceBindingInput,
  normalizeWorkerIdentityEvidenceBindingReference,
  type WorkerIdentityDocumentType,
  type WorkerIdentityEvidenceBindingInput,
  type WorkerIdentityEvidenceBindingRecord
} from "./worker-identity-evidence-domain";

export const WORKER_IDENTITY_EVIDENCE_LIVE_AUTHORITY_SQL = `
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

const CURRENT_EDITABLE_VERSION_SQL = `
SELECT
  identities.identity_id,
  identities.lifecycle_status,
  identities.current_version_number,
  versions.identity_version_id,
  versions.version_number,
  versions.version_status
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
WHERE identities.worker_account_id = $1`;

const CURRENT_EDITABLE_VERSION_FOR_UPDATE_SQL = `${CURRENT_EDITABLE_VERSION_SQL}
FOR UPDATE OF identities, versions`;

const ACTIVE_BINDING_SQL = `
SELECT *
FROM worker_identity_evidence_bindings
WHERE identity_version_id = $1
  AND purpose = $2
  AND binding_status = 'active'`;

const CURRENT_VERSION_HISTORY_SQL = `
SELECT evidence.*
FROM worker_identity_evidence_bindings AS evidence
JOIN worker_identities AS identities
  ON identities.worker_account_id = $1
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
WHERE evidence.identity_version_id = versions.identity_version_id
  AND evidence.worker_account_id = $1
ORDER BY evidence.purpose, evidence.created_at DESC, evidence.binding_id`;

const BINDABLE_SECURE_FILE_SQL = `
SELECT file_id, detected_mime
FROM platform_secure_files
WHERE file_id = $1
  AND owner_account_id = $2
  AND owner_role = 'worker'
  AND tenant_id IS NULL
  AND membership_id IS NULL
  AND lifecycle_status = 'available'`;

type CurrentVersionRow = {
  identity_id: string;
  lifecycle_status: string;
  current_version_number: number | string;
  identity_version_id: string;
  version_number: number | string;
  version_status: string;
};

type BindingRow = {
  binding_id: string;
  identity_version_id: string;
  worker_account_id: string;
  purpose: string;
  secure_file_id: string;
  document_type: string | null;
  document_number: string | null;
  issue_date: string | Date | null;
  expiry_date: string | Date | null;
  binding_status: string;
  supersedes_binding_id: string | null;
  created_by_account_id: string;
  created_at: string | Date;
  superseded_at: string | Date | null;
};

type SecureFileRow = {
  file_id: string;
  detected_mime: string | null;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function bindingFromRow(row: BindingRow): WorkerIdentityEvidenceBindingRecord {
  if (
    !isWorkerIdentityEvidencePurpose(row.purpose) ||
    (row.document_type !== null && !isWorkerIdentityDocumentType(row.document_type)) ||
    (row.binding_status !== "active" && row.binding_status !== "superseded")
  ) {
    throw new Error("Stored Worker identity evidence vocabulary is invalid.");
  }
  const bindingId = normalizeWorkerIdentityEvidenceBindingReference(row.binding_id);
  const supersedesBindingId = normalizeWorkerIdentityEvidenceBindingReference(
    row.supersedes_binding_id
  );
  if (!bindingId) {
    throw new Error("Stored Worker identity evidence reference is invalid.");
  }
  return Object.freeze({
    bindingId,
    identityVersionId: row.identity_version_id,
    purpose: row.purpose,
    secureFileId: row.secure_file_id,
    documentType: row.document_type as WorkerIdentityDocumentType | null,
    documentNumber: row.document_number,
    issueDate: dateOnly(row.issue_date),
    expiryDate: dateOnly(row.expiry_date),
    status: row.binding_status,
    supersedesBindingId,
    createdAt: timestamp(row.created_at),
    supersededAt: optionalTimestamp(row.superseded_at)
  });
}

async function assertLiveWorkerAuthority(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<void> {
  const worker = assertWorkerIdentityPrincipal(principal);
  const result = await database.query<{ session_id: string }>(
    WORKER_IDENTITY_EVIDENCE_LIVE_AUTHORITY_SQL,
    [worker.sessionId, worker.accountId]
  );
  if (result.rows.length !== 1) {
    throw new WorkerIdentityAccessDeniedError();
  }
}

async function currentVersion(
  database: DatabaseClient,
  workerAccountId: string,
  forUpdate: boolean
): Promise<CurrentVersionRow | null> {
  const result = await database.query<CurrentVersionRow>(
    forUpdate
      ? CURRENT_EDITABLE_VERSION_FOR_UPDATE_SQL
      : CURRENT_EDITABLE_VERSION_SQL,
    [workerAccountId]
  );
  if (result.rows.length > 1) {
    throw new Error("Worker identity current evidence version is corrupted.");
  }
  return result.rows[0] ?? null;
}

function requireEditableVersion(row: CurrentVersionRow | null): CurrentVersionRow {
  if (!row) throw new WorkerIdentityNotFoundError();
  if (
    row.version_status !== "draft" ||
    Number(row.current_version_number) !== Number(row.version_number) ||
    (row.lifecycle_status !== "draft" && row.lifecycle_status !== "correction_pending")
  ) {
    throw new WorkerIdentityConflictError(
      "The current Worker identity version is not editable."
    );
  }
  return row;
}

function sameBinding(
  current: WorkerIdentityEvidenceBindingRecord,
  input: WorkerIdentityEvidenceBindingInput
): boolean {
  return (
    current.status === "active" &&
    current.purpose === input.purpose &&
    current.secureFileId === input.secureFileId &&
    current.documentType === input.documentType &&
    current.documentNumber === input.documentNumber &&
    current.issueDate === input.issueDate &&
    current.expiryDate === input.expiryDate
  );
}

async function requireBindableSecureFile(
  database: DatabaseClient,
  workerAccountId: string,
  input: WorkerIdentityEvidenceBindingInput
): Promise<void> {
  const file = await database.query<SecureFileRow>(BINDABLE_SECURE_FILE_SQL, [
    input.secureFileId,
    workerAccountId
  ]);
  const row = file.rows[0];
  if (!row) throw new WorkerIdentityEvidenceUnavailableError();
  if (
    (input.purpose === "profile_photo" || input.purpose === "selfie") &&
    row.detected_mime !== "image/png" &&
    row.detected_mime !== "image/jpeg"
  ) {
    throw new WorkerIdentityEvidenceUnavailableError();
  }
}

export interface WorkerIdentityEvidenceRepository {
  listOwn(
    principal: AuthorizationPrincipal
  ): Promise<readonly WorkerIdentityEvidenceBindingRecord[]>;
  bindOwn(
    principal: AuthorizationPrincipal,
    input: WorkerIdentityEvidenceBindingInput,
    expectedActiveBindingId: string | null
  ): Promise<WorkerIdentityEvidenceBindingRecord>;
}

export class DatabaseWorkerIdentityEvidenceRepository
  implements WorkerIdentityEvidenceRepository
{
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async listOwn(
    principal: AuthorizationPrincipal
  ): Promise<readonly WorkerIdentityEvidenceBindingRecord[]> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await assertLiveWorkerAuthority(transaction, worker);
      const version = await currentVersion(transaction, worker.accountId, false);
      if (!version) return Object.freeze([]);
      const result = await transaction.query<BindingRow>(
        CURRENT_VERSION_HISTORY_SQL,
        [worker.accountId]
      );
      return Object.freeze(result.rows.map(bindingFromRow));
    });
  }

  async bindOwn(
    principal: AuthorizationPrincipal,
    input: WorkerIdentityEvidenceBindingInput,
    expectedActiveBindingIdInput: string | null
  ): Promise<WorkerIdentityEvidenceBindingRecord> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const normalized = normalizeWorkerIdentityEvidenceBindingInput(input);
    const expectedActiveBindingId = normalizeWorkerIdentityEvidenceBindingReference(
      expectedActiveBindingIdInput
    );
    const database = await this.client();

    return database.transaction(async (transaction) => {
      await assertLiveWorkerAuthority(transaction, worker);
      const version = requireEditableVersion(
        await currentVersion(transaction, worker.accountId, true)
      );
      await requireBindableSecureFile(transaction, worker.accountId, normalized);

      const activeResult = await transaction.query<BindingRow>(ACTIVE_BINDING_SQL, [
        version.identity_version_id,
        normalized.purpose
      ]);
      if (activeResult.rows.length > 1) {
        throw new Error("Worker identity active evidence uniqueness is corrupted.");
      }
      const active = activeResult.rows[0]
        ? bindingFromRow(activeResult.rows[0])
        : null;

      // Exact retries are idempotent even when the original request expected no
      // active binding. A materially different replacement must be based on the
      // exact active binding the caller observed.
      if (active && sameBinding(active, normalized)) return active;
      if (
        (active === null && expectedActiveBindingId !== null) ||
        (active !== null && expectedActiveBindingId !== active.bindingId)
      ) {
        throw new WorkerIdentityEvidenceConflictError();
      }

      let supersedesBindingId: string | null = null;
      if (active) {
        const superseded = await transaction.query<{ binding_id: string }>(
          `UPDATE worker_identity_evidence_bindings
           SET binding_status = 'superseded'
           WHERE binding_id = $1
             AND identity_version_id = $2
             AND worker_account_id = $3
             AND purpose = $4
             AND binding_status = 'active'
           RETURNING binding_id`,
          [
            active.bindingId,
            version.identity_version_id,
            worker.accountId,
            normalized.purpose
          ]
        );
        if (superseded.rows.length !== 1) {
          throw new WorkerIdentityEvidenceConflictError();
        }
        supersedesBindingId = active.bindingId;
      }

      const bindingId = createWorkerIdentityEvidenceBindingId();
      const inserted = await transaction.query<BindingRow>(
        `INSERT INTO worker_identity_evidence_bindings (
           binding_id,
           identity_version_id,
           worker_account_id,
           purpose,
           secure_file_id,
           document_type,
           document_number,
           issue_date,
           expiry_date,
           binding_status,
           supersedes_binding_id,
           created_by_account_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $3)
         RETURNING *`,
        [
          bindingId,
          version.identity_version_id,
          worker.accountId,
          normalized.purpose,
          normalized.secureFileId,
          normalized.documentType,
          normalized.documentNumber,
          normalized.issueDate,
          normalized.expiryDate,
          supersedesBindingId
        ]
      );
      if (inserted.rows.length !== 1) {
        throw new WorkerIdentityEvidenceConflictError();
      }
      return bindingFromRow(inserted.rows[0]);
    });
  }
}

let repository: WorkerIdentityEvidenceRepository | null = null;

export function getWorkerIdentityEvidenceRepository(): WorkerIdentityEvidenceRepository {
  repository ??= new DatabaseWorkerIdentityEvidenceRepository();
  return repository;
}
