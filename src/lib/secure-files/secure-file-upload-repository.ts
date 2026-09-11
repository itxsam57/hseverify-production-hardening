import "server-only";

import {
  assertTrustedAuditActor,
  type TrustedAuditActor
} from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  SECURE_FILE_SCHEMA_VERSION,
  SecureFileAccessDeniedError,
  SecureFileContractError,
  SecureFileReservationConflictError,
  assertTrustedSecureFileOwner,
  isSecureFileLifecycleStatus,
  isSecureFileStorageAdapterKey,
  normalizeSecureFileReference,
  type SecureFileRecord,
  type TrustedSecureFileOwner
} from "./secure-file-domain";
import {
  assertTrustedStoredSecureFileUpload,
  secureFileMatchesStoredUpload,
  type TrustedStoredSecureFileUpload
} from "./secure-file-upload-domain";

export const SECURE_FILE_UPLOAD_SESSION_GUARD_SQL = `
SELECT sessions.session_id
FROM auth_sessions AS sessions
JOIN auth_accounts AS accounts
  ON accounts.account_id = sessions.account_id
JOIN auth_account_roles AS roles
  ON roles.account_id = sessions.account_id
 AND roles.role = sessions.active_role
WHERE sessions.session_id = $1
  AND sessions.account_id = $2
  AND sessions.active_role = $3
  AND accounts.account_status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > CURRENT_TIMESTAMP
FOR UPDATE OF sessions, accounts`;

export const SECURE_FILE_UPLOAD_COMPANY_SCOPE_GUARD_SQL = `
SELECT memberships.membership_id
FROM auth_tenant_memberships AS memberships
JOIN platform_tenants AS tenants
  ON tenants.tenant_id = memberships.tenant_id
WHERE memberships.membership_id = $1
  AND memberships.tenant_id = $2
  AND memberships.account_id = $3
  AND memberships.portal_role = 'company'
  AND memberships.membership_status = 'active'
  AND tenants.tenant_status = 'active'
FOR UPDATE OF memberships, tenants`;

export const SECURE_FILE_UPLOAD_COMPANY_APPLICATION_SCOPE_GUARD_SQL = `
SELECT memberships.membership_id
FROM auth_tenant_memberships AS memberships
JOIN platform_tenants AS tenants
  ON tenants.tenant_id = memberships.tenant_id
WHERE memberships.membership_id = $1
  AND memberships.tenant_id = $2
  AND memberships.account_id = $3
  AND memberships.portal_role = 'company'
  AND memberships.membership_status = 'active'
  AND memberships.membership_role IN ('owner', 'admin')
  AND tenants.tenant_status IN ('pending', 'active')
FOR UPDATE OF memberships, tenants`;

export const SECURE_FILE_UPLOAD_LOCK_SQL = `
SELECT *
FROM platform_secure_files
WHERE file_id = $1
  AND owner_account_id = $2
  AND owner_role = $3
  AND (
    (
      $3 = 'company'
      AND tenant_id = $4
      AND membership_id = $5
    ) OR (
      $3 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )
FOR UPDATE`;

export const SECURE_FILE_QUARANTINE_SQL = `
UPDATE platform_secure_files
SET lifecycle_status = 'quarantined',
    file_extension = $6,
    declared_mime = $7,
    detected_mime = $8,
    byte_size = $9,
    content_sha256 = $10
WHERE file_id = $1
  AND owner_account_id = $2
  AND owner_role = $3
  AND (
    (
      $3 = 'company'
      AND tenant_id = $4
      AND membership_id = $5
    ) OR (
      $3 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )
  AND lifecycle_status = 'reserved'
RETURNING *`;

type SecureFileRow = {
  file_sequence: number | string;
  file_id: string;
  schema_version: number | string;
  reservation_key: string;
  owner_account_id: string;
  owner_role: SecureFileRecord["ownerRole"];
  tenant_id: string | null;
  membership_id: string | null;
  storage_adapter_key: string;
  object_key: string;
  display_filename: string;
  lifecycle_status: string;
  file_extension: string | null;
  declared_mime: string | null;
  detected_mime: string | null;
  byte_size: number | string | null;
  content_sha256: string | null;
  quarantined_at: string | Date | null;
  available_at: string | Date | null;
  unsafe_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function validExtension(
  value: string | null
): value is "pdf" | "png" | "jpg" | "jpeg" | null {
  return value === null || value === "pdf" || value === "png" || value === "jpg" || value === "jpeg";
}

function validMime(
  value: string | null
): value is "application/pdf" | "image/png" | "image/jpeg" | null {
  return value === null || value === "application/pdf" || value === "image/png" || value === "image/jpeg";
}

function fromRow(row: SecureFileRow): SecureFileRecord {
  if (
    Number(row.schema_version) !== SECURE_FILE_SCHEMA_VERSION ||
    !normalizeSecureFileReference(row.file_id) ||
    !isSecureFileLifecycleStatus(row.lifecycle_status) ||
    !isSecureFileStorageAdapterKey(row.storage_adapter_key) ||
    !validExtension(row.file_extension) ||
    !validMime(row.declared_mime) ||
    !validMime(row.detected_mime)
  ) {
    throw new SecureFileContractError("Stored secure file vocabulary is invalid.");
  }
  const byteSize = row.byte_size === null ? null : Number(row.byte_size);
  if (byteSize !== null && (!Number.isSafeInteger(byteSize) || byteSize < 1)) {
    throw new SecureFileContractError("Stored secure file byte size is invalid.");
  }
  return Object.freeze({
    sequence: Number(row.file_sequence),
    fileId: row.file_id,
    schemaVersion: SECURE_FILE_SCHEMA_VERSION,
    reservationKey: row.reservation_key,
    ownerAccountId: row.owner_account_id,
    ownerRole: row.owner_role,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    storageAdapterKey: row.storage_adapter_key,
    objectKey: row.object_key,
    displayFilename: row.display_filename,
    lifecycleStatus: row.lifecycle_status,
    fileExtension: row.file_extension,
    declaredMime: row.declared_mime,
    detectedMime: row.detected_mime,
    byteSize,
    contentSha256: row.content_sha256,
    quarantinedAt: optionalTimestamp(row.quarantined_at),
    availableAt: optionalTimestamp(row.available_at),
    unsafeAt: optionalTimestamp(row.unsafe_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  });
}

function fileScopeParameters(
  fileId: string,
  owner: TrustedSecureFileOwner
): readonly [string, string, string, string | null, string | null] {
  return [fileId, owner.accountId, owner.role, owner.tenantId, owner.membershipId];
}

async function assertLiveOwner(
  database: DatabaseClient,
  owner: TrustedSecureFileOwner
): Promise<void> {
  const session = await database.query<{ session_id: string }>(
    SECURE_FILE_UPLOAD_SESSION_GUARD_SQL,
    [owner.sessionId, owner.accountId, owner.role]
  );
  if (session.rows[0]?.session_id !== owner.sessionId) {
    throw new SecureFileAccessDeniedError();
  }

  if (owner.role === "company") {
    if (!owner.tenantId || !owner.membershipId) {
      throw new SecureFileAccessDeniedError();
    }
    const guardSql = owner.authorityMode === "company_application"
      ? SECURE_FILE_UPLOAD_COMPANY_APPLICATION_SCOPE_GUARD_SQL
      : SECURE_FILE_UPLOAD_COMPANY_SCOPE_GUARD_SQL;
    const membership = await database.query<{ membership_id: string }>(
      guardSql,
      [owner.membershipId, owner.tenantId, owner.accountId]
    );
    if (membership.rows[0]?.membership_id !== owner.membershipId) {
      throw new SecureFileAccessDeniedError();
    }
  } else if (
    owner.tenantId !== null ||
    owner.membershipId !== null ||
    owner.authorityMode !== "active_tenant"
  ) {
    throw new SecureFileAccessDeniedError();
  }
}

function assertActorMatchesOwner(
  actorInput: TrustedAuditActor,
  owner: TrustedSecureFileOwner
): TrustedAuditActor {
  const actor = assertTrustedAuditActor(actorInput);
  if (
    actor.kind !== "user" ||
    actor.accountId !== owner.accountId ||
    actor.sessionId !== owner.sessionId ||
    actor.activeRole !== owner.role ||
    actor.tenantId !== owner.tenantId ||
    actor.membershipId !== owner.membershipId
  ) {
    throw new SecureFileAccessDeniedError();
  }
  return actor;
}

export type SecureFileQuarantineResult = Readonly<{
  created: boolean;
  file: SecureFileRecord;
}>;

export interface SecureFileUploadRepository {
  finalizeQuarantine(
    owner: TrustedSecureFileOwner,
    actor: TrustedAuditActor,
    upload: TrustedStoredSecureFileUpload
  ): Promise<SecureFileQuarantineResult>;
}

export class DatabaseSecureFileUploadRepository implements SecureFileUploadRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  async finalizeQuarantine(
    ownerInput: TrustedSecureFileOwner,
    actorInput: TrustedAuditActor,
    uploadInput: TrustedStoredSecureFileUpload
  ): Promise<SecureFileQuarantineResult> {
    const owner = assertTrustedSecureFileOwner(ownerInput);
    const actor = assertActorMatchesOwner(actorInput, owner);
    const upload = assertTrustedStoredSecureFileUpload(uploadInput);
    const database = await this.clientPromise;

    return database.transaction(async (transaction) => {
      await assertLiveOwner(transaction, owner);
      const locked = await transaction.query<SecureFileRow>(
        SECURE_FILE_UPLOAD_LOCK_SQL,
        fileScopeParameters(upload.fileId, owner)
      );
      const row = locked.rows[0];
      if (!row) throw new SecureFileAccessDeniedError();
      const current = fromRow(row);

      if (
        current.objectKey !== upload.objectKey ||
        current.displayFilename !== upload.displayFilename
      ) {
        throw new SecureFileReservationConflictError();
      }

      if (current.lifecycleStatus === "quarantined") {
        if (!secureFileMatchesStoredUpload(current, upload)) {
          throw new SecureFileReservationConflictError();
        }
        return Object.freeze({ created: false, file: current });
      }
      if (current.lifecycleStatus !== "reserved") {
        throw new SecureFileReservationConflictError();
      }

      const updated = await transaction.query<SecureFileRow>(
        SECURE_FILE_QUARANTINE_SQL,
        [
          ...fileScopeParameters(upload.fileId, owner),
          upload.fileExtension,
          upload.declaredMime,
          upload.detectedMime,
          upload.byteSize,
          upload.contentSha256
        ]
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new SecureFileReservationConflictError();
      const file = fromRow(updatedRow);
      if (
        file.lifecycleStatus !== "quarantined" ||
        !secureFileMatchesStoredUpload(file, upload)
      ) {
        throw new SecureFileReservationConflictError();
      }

      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(actor, {
        action: "secure_file.quarantined",
        outcome: "succeeded",
        target: { type: "secure_file", reference: file.fileId },
        metadata: {
          policyKey: upload.policyKey,
          fileExtension: upload.fileExtension,
          declaredMime: upload.declaredMime,
          detectedMime: upload.detectedMime,
          byteSize: upload.byteSize
        }
      });

      return Object.freeze({ created: true, file });
    });
  }
}

let repository: SecureFileUploadRepository | null = null;

export function getSecureFileUploadRepository(): SecureFileUploadRepository {
  repository ??= new DatabaseSecureFileUploadRepository();
  return repository;
}
