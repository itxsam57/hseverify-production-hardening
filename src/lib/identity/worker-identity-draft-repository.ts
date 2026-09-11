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
  WorkerIdentityContactVerificationRequiredError,
  normalizeWorkerIdentityDraftInput,
  normalizeWorkerIdentityDraftRevision,
  type WorkerIdentityDraftInput,
  type WorkerIdentityDraftRecord
} from "./worker-identity-draft-domain";

export const WORKER_IDENTITY_DRAFT_LIVE_AUTHORITY_SQL = `
SELECT
  sessions.session_id,
  accounts.email_normalized,
  accounts.email_verified_at,
  accounts.phone_e164,
  accounts.phone_verified_at
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

const CURRENT_IDENTITY_VERSION_SQL = `
SELECT
  identities.identity_id,
  identities.lifecycle_status,
  identities.current_version_number,
  versions.identity_version_id,
  versions.version_status
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
WHERE identities.worker_account_id = $1`;

const CURRENT_IDENTITY_VERSION_FOR_UPDATE_SQL = `${CURRENT_IDENTITY_VERSION_SQL}
FOR UPDATE OF identities, versions`;

const DRAFT_RECORD_SQL = `
SELECT
  identity_version_id,
  draft_revision,
  legal_first_name,
  legal_last_name,
  previous_legal_name,
  date_of_birth,
  nationality,
  country_of_residence,
  verified_email_normalized,
  email_verified_at,
  verified_phone_e164,
  phone_verified_at,
  created_at,
  updated_at
FROM worker_identity_version_drafts
WHERE identity_version_id = $1`;

type LiveAuthorityRow = {
  session_id: string;
  email_normalized: string;
  email_verified_at: string | Date | null;
  phone_e164: string | null;
  phone_verified_at: string | Date | null;
};

type CurrentVersionRow = {
  identity_id: string;
  lifecycle_status: string;
  current_version_number: number | string;
  identity_version_id: string;
  version_status: string;
};

type DraftRecordRow = {
  identity_version_id: string;
  draft_revision: number | string;
  legal_first_name: string | null;
  legal_last_name: string | null;
  previous_legal_name: string | null;
  date_of_birth: string | Date | null;
  nationality: string | null;
  country_of_residence: string | null;
  verified_email_normalized: string;
  email_verified_at: string | Date;
  verified_phone_e164: string;
  phone_verified_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function draftFromRow(row: DraftRecordRow): WorkerIdentityDraftRecord {
  const draftRevision = Number(row.draft_revision);
  if (!Number.isSafeInteger(draftRevision) || draftRevision < 1) {
    throw new Error("Stored Worker identity draft revision is invalid.");
  }
  return Object.freeze({
    identityVersionId: row.identity_version_id,
    draftRevision,
    legalFirstName: row.legal_first_name,
    legalLastName: row.legal_last_name,
    previousLegalName: row.previous_legal_name,
    dateOfBirth: dateOnly(row.date_of_birth),
    nationality: row.nationality,
    countryOfResidence: row.country_of_residence,
    verifiedContacts: Object.freeze({
      emailNormalized: row.verified_email_normalized,
      emailVerifiedAt: timestamp(row.email_verified_at),
      phoneE164: row.verified_phone_e164,
      phoneVerifiedAt: timestamp(row.phone_verified_at)
    }),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  });
}

async function liveWorkerAuthority(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<LiveAuthorityRow> {
  const worker = assertWorkerIdentityPrincipal(principal);
  const result = await database.query<LiveAuthorityRow>(
    WORKER_IDENTITY_DRAFT_LIVE_AUTHORITY_SQL,
    [worker.sessionId, worker.accountId]
  );
  if (result.rows.length !== 1) {
    throw new WorkerIdentityAccessDeniedError();
  }
  return result.rows[0];
}

function requireVerifiedContacts(authority: LiveAuthorityRow): Readonly<{
  emailNormalized: string;
  emailVerifiedAt: string | Date;
  phoneE164: string;
  phoneVerifiedAt: string | Date;
}> {
  if (
    !authority.email_normalized ||
    authority.email_verified_at === null ||
    !authority.phone_e164 ||
    authority.phone_verified_at === null
  ) {
    throw new WorkerIdentityContactVerificationRequiredError();
  }
  return Object.freeze({
    emailNormalized: authority.email_normalized,
    emailVerifiedAt: authority.email_verified_at,
    phoneE164: authority.phone_e164,
    phoneVerifiedAt: authority.phone_verified_at
  });
}

async function currentVersion(
  database: DatabaseClient,
  workerAccountId: string,
  forUpdate: boolean
): Promise<CurrentVersionRow | null> {
  const result = await database.query<CurrentVersionRow>(
    forUpdate
      ? CURRENT_IDENTITY_VERSION_FOR_UPDATE_SQL
      : CURRENT_IDENTITY_VERSION_SQL,
    [workerAccountId]
  );
  if (result.rows.length > 1) {
    throw new Error("Worker identity current-version ownership is corrupted.");
  }
  return result.rows[0] ?? null;
}

function assertEditableCurrentVersion(
  row: CurrentVersionRow | null
): CurrentVersionRow {
  if (!row) throw new WorkerIdentityNotFoundError();
  if (
    row.version_status !== "draft" ||
    (row.lifecycle_status !== "draft" &&
      row.lifecycle_status !== "correction_pending")
  ) {
    throw new WorkerIdentityConflictError(
      "The current Worker identity version is not editable."
    );
  }
  return row;
}

async function loadDraft(
  database: DatabaseClient,
  identityVersionId: string
): Promise<WorkerIdentityDraftRecord | null> {
  const result = await database.query<DraftRecordRow>(DRAFT_RECORD_SQL, [
    identityVersionId
  ]);
  if (result.rows.length > 1) {
    throw new Error("Worker identity draft uniqueness is corrupted.");
  }
  return result.rows[0] ? draftFromRow(result.rows[0]) : null;
}

export interface WorkerIdentityDraftRepository {
  loadOwn(principal: AuthorizationPrincipal): Promise<WorkerIdentityDraftRecord | null>;
  ensureOwn(principal: AuthorizationPrincipal): Promise<WorkerIdentityDraftRecord>;
  saveOwn(
    principal: AuthorizationPrincipal,
    input: WorkerIdentityDraftInput,
    expectedDraftRevision: number | null
  ): Promise<WorkerIdentityDraftRecord>;
}

export class DatabaseWorkerIdentityDraftRepository
  implements WorkerIdentityDraftRepository
{
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private async client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async loadOwn(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityDraftRecord | null> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      await liveWorkerAuthority(transaction, worker);
      const version = await currentVersion(transaction, worker.accountId, false);
      if (!version) return null;
      return loadDraft(transaction, version.identity_version_id);
    });
  }

  async ensureOwn(
    principal: AuthorizationPrincipal
  ): Promise<WorkerIdentityDraftRecord> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const authority = requireVerifiedContacts(
        await liveWorkerAuthority(transaction, worker)
      );
      const version = assertEditableCurrentVersion(
        await currentVersion(transaction, worker.accountId, true)
      );

      await transaction.query(
        `INSERT INTO worker_identity_version_drafts (
           identity_version_id,
           draft_revision,
           legal_first_name,
           legal_last_name,
           previous_legal_name,
           date_of_birth,
           nationality,
           country_of_residence,
           verified_email_normalized,
           email_verified_at,
           verified_phone_e164,
           phone_verified_at
         ) VALUES ($1, 1, NULL, NULL, NULL, NULL, NULL, NULL, $2, $3, $4, $5)
         ON CONFLICT (identity_version_id) DO NOTHING`,
        [
          version.identity_version_id,
          authority.emailNormalized,
          authority.emailVerifiedAt,
          authority.phoneE164,
          authority.phoneVerifiedAt
        ]
      );

      const draft = await loadDraft(transaction, version.identity_version_id);
      if (!draft) {
        throw new Error("Worker identity draft initialization did not produce durable state.");
      }
      return draft;
    });
  }

  async saveOwn(
    principal: AuthorizationPrincipal,
    input: WorkerIdentityDraftInput,
    expectedDraftRevisionInput: number | null
  ): Promise<WorkerIdentityDraftRecord> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const normalized = normalizeWorkerIdentityDraftInput(input);
    const expectedDraftRevision = normalizeWorkerIdentityDraftRevision(
      expectedDraftRevisionInput
    );
    const database = await this.client();

    return database.transaction(async (transaction) => {
      const authority = requireVerifiedContacts(
        await liveWorkerAuthority(transaction, worker)
      );
      const version = assertEditableCurrentVersion(
        await currentVersion(transaction, worker.accountId, true)
      );

      if (expectedDraftRevision === null) {
        const inserted = await transaction.query<{ identity_version_id: string }>(
          `INSERT INTO worker_identity_version_drafts (
             identity_version_id,
             draft_revision,
             legal_first_name,
             legal_last_name,
             previous_legal_name,
             date_of_birth,
             nationality,
             country_of_residence,
             verified_email_normalized,
             email_verified_at,
             verified_phone_e164,
             phone_verified_at
           ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (identity_version_id) DO NOTHING
           RETURNING identity_version_id`,
          [
            version.identity_version_id,
            normalized.legalFirstName,
            normalized.legalLastName,
            normalized.previousLegalName,
            normalized.dateOfBirth,
            normalized.nationality,
            normalized.countryOfResidence,
            authority.emailNormalized,
            authority.emailVerifiedAt,
            authority.phoneE164,
            authority.phoneVerifiedAt
          ]
        );
        if (inserted.rows.length !== 1) {
          throw new WorkerIdentityConflictError(
            "The Worker identity draft was already created."
          );
        }
      } else {
        const updated = await transaction.query<{ identity_version_id: string }>(
          `UPDATE worker_identity_version_drafts
           SET draft_revision = draft_revision + 1,
               legal_first_name = $3,
               legal_last_name = $4,
               previous_legal_name = $5,
               date_of_birth = $6,
               nationality = $7,
               country_of_residence = $8,
               verified_email_normalized = $9,
               email_verified_at = $10,
               verified_phone_e164 = $11,
               phone_verified_at = $12
           WHERE identity_version_id = $1
             AND draft_revision = $2
           RETURNING identity_version_id`,
          [
            version.identity_version_id,
            expectedDraftRevision,
            normalized.legalFirstName,
            normalized.legalLastName,
            normalized.previousLegalName,
            normalized.dateOfBirth,
            normalized.nationality,
            normalized.countryOfResidence,
            authority.emailNormalized,
            authority.emailVerifiedAt,
            authority.phoneE164,
            authority.phoneVerifiedAt
          ]
        );
        if (updated.rows.length !== 1) {
          throw new WorkerIdentityConflictError(
            "The Worker identity draft changed before this save completed."
          );
        }
      }

      const draft = await loadDraft(transaction, version.identity_version_id);
      if (!draft) {
        throw new Error("Worker identity draft save did not produce durable state.");
      }
      return draft;
    });
  }
}

let repository: WorkerIdentityDraftRepository | null = null;

export function getWorkerIdentityDraftRepository(): WorkerIdentityDraftRepository {
  repository ??= new DatabaseWorkerIdentityDraftRepository();
  return repository;
}
