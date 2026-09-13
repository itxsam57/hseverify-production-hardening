"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseSecureFileUploadRepository = exports.SECURE_FILE_QUARANTINE_SQL = exports.SECURE_FILE_UPLOAD_LOCK_SQL = exports.SECURE_FILE_UPLOAD_COMPANY_APPLICATION_SCOPE_GUARD_SQL = exports.SECURE_FILE_UPLOAD_COMPANY_SCOPE_GUARD_SQL = exports.SECURE_FILE_UPLOAD_SESSION_GUARD_SQL = void 0;
exports.getSecureFileUploadRepository = getSecureFileUploadRepository;
const audit_domain_1 = require("../audit/audit-domain");
const audit_repository_1 = require("../audit/audit-repository");
const database_1 = require("../database/database");
const secure_file_domain_1 = require("./secure-file-domain");
const secure_file_upload_domain_1 = require("./secure-file-upload-domain");
exports.SECURE_FILE_UPLOAD_SESSION_GUARD_SQL = `
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
exports.SECURE_FILE_UPLOAD_COMPANY_SCOPE_GUARD_SQL = `
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
exports.SECURE_FILE_UPLOAD_COMPANY_APPLICATION_SCOPE_GUARD_SQL = `
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
exports.SECURE_FILE_UPLOAD_LOCK_SQL = `
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
exports.SECURE_FILE_QUARANTINE_SQL = `
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
function timestamp(value) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function optionalTimestamp(value) {
    return value === null ? null : timestamp(value);
}
function validExtension(value) {
    return value === null || value === "pdf" || value === "png" || value === "jpg" || value === "jpeg";
}
function validMime(value) {
    return value === null || value === "application/pdf" || value === "image/png" || value === "image/jpeg";
}
function fromRow(row) {
    if (Number(row.schema_version) !== secure_file_domain_1.SECURE_FILE_SCHEMA_VERSION ||
        !(0, secure_file_domain_1.normalizeSecureFileReference)(row.file_id) ||
        !(0, secure_file_domain_1.isSecureFileLifecycleStatus)(row.lifecycle_status) ||
        !(0, secure_file_domain_1.isSecureFileStorageAdapterKey)(row.storage_adapter_key) ||
        !validExtension(row.file_extension) ||
        !validMime(row.declared_mime) ||
        !validMime(row.detected_mime)) {
        throw new secure_file_domain_1.SecureFileContractError("Stored secure file vocabulary is invalid.");
    }
    const byteSize = row.byte_size === null ? null : Number(row.byte_size);
    if (byteSize !== null && (!Number.isSafeInteger(byteSize) || byteSize < 1)) {
        throw new secure_file_domain_1.SecureFileContractError("Stored secure file byte size is invalid.");
    }
    return Object.freeze({
        sequence: Number(row.file_sequence),
        fileId: row.file_id,
        schemaVersion: secure_file_domain_1.SECURE_FILE_SCHEMA_VERSION,
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
function fileScopeParameters(fileId, owner) {
    return [fileId, owner.accountId, owner.role, owner.tenantId, owner.membershipId];
}
async function assertLiveOwner(database, owner) {
    const session = await database.query(exports.SECURE_FILE_UPLOAD_SESSION_GUARD_SQL, [owner.sessionId, owner.accountId, owner.role]);
    if (session.rows[0]?.session_id !== owner.sessionId) {
        throw new secure_file_domain_1.SecureFileAccessDeniedError();
    }
    if (owner.role === "company") {
        if (!owner.tenantId || !owner.membershipId) {
            throw new secure_file_domain_1.SecureFileAccessDeniedError();
        }
        const guardSql = owner.authorityMode === "company_application"
            ? exports.SECURE_FILE_UPLOAD_COMPANY_APPLICATION_SCOPE_GUARD_SQL
            : exports.SECURE_FILE_UPLOAD_COMPANY_SCOPE_GUARD_SQL;
        const membership = await database.query(guardSql, [owner.membershipId, owner.tenantId, owner.accountId]);
        if (membership.rows[0]?.membership_id !== owner.membershipId) {
            throw new secure_file_domain_1.SecureFileAccessDeniedError();
        }
    }
    else if (owner.tenantId !== null ||
        owner.membershipId !== null ||
        owner.authorityMode !== "active_tenant") {
        throw new secure_file_domain_1.SecureFileAccessDeniedError();
    }
}
function assertActorMatchesOwner(actorInput, owner) {
    const actor = (0, audit_domain_1.assertTrustedAuditActor)(actorInput);
    if (actor.kind !== "user" ||
        actor.accountId !== owner.accountId ||
        actor.sessionId !== owner.sessionId ||
        actor.activeRole !== owner.role ||
        actor.tenantId !== owner.tenantId ||
        actor.membershipId !== owner.membershipId) {
        throw new secure_file_domain_1.SecureFileAccessDeniedError();
    }
    return actor;
}
class DatabaseSecureFileUploadRepository {
    clientPromise;
    constructor(clientPromise = (0, database_1.getDatabaseClient)()) {
        this.clientPromise = clientPromise;
    }
    async finalizeQuarantine(ownerInput, actorInput, uploadInput) {
        const owner = (0, secure_file_domain_1.assertTrustedSecureFileOwner)(ownerInput);
        const actor = assertActorMatchesOwner(actorInput, owner);
        const upload = (0, secure_file_upload_domain_1.assertTrustedStoredSecureFileUpload)(uploadInput);
        const database = await this.clientPromise;
        return database.transaction(async (transaction) => {
            await assertLiveOwner(transaction, owner);
            const locked = await transaction.query(exports.SECURE_FILE_UPLOAD_LOCK_SQL, fileScopeParameters(upload.fileId, owner));
            const row = locked.rows[0];
            if (!row)
                throw new secure_file_domain_1.SecureFileAccessDeniedError();
            const current = fromRow(row);
            if (current.objectKey !== upload.objectKey ||
                current.displayFilename !== upload.displayFilename) {
                throw new secure_file_domain_1.SecureFileReservationConflictError();
            }
            if (current.lifecycleStatus === "quarantined") {
                if (!(0, secure_file_upload_domain_1.secureFileMatchesStoredUpload)(current, upload)) {
                    throw new secure_file_domain_1.SecureFileReservationConflictError();
                }
                return Object.freeze({ created: false, file: current });
            }
            if (current.lifecycleStatus !== "reserved") {
                throw new secure_file_domain_1.SecureFileReservationConflictError();
            }
            const updated = await transaction.query(exports.SECURE_FILE_QUARANTINE_SQL, [
                ...fileScopeParameters(upload.fileId, owner),
                upload.fileExtension,
                upload.declaredMime,
                upload.detectedMime,
                upload.byteSize,
                upload.contentSha256
            ]);
            const updatedRow = updated.rows[0];
            if (!updatedRow)
                throw new secure_file_domain_1.SecureFileReservationConflictError();
            const file = fromRow(updatedRow);
            if (file.lifecycleStatus !== "quarantined" ||
                !(0, secure_file_upload_domain_1.secureFileMatchesStoredUpload)(file, upload)) {
                throw new secure_file_domain_1.SecureFileReservationConflictError();
            }
            const audit = new audit_repository_1.DatabaseAuditRepository(Promise.resolve(transaction));
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
exports.DatabaseSecureFileUploadRepository = DatabaseSecureFileUploadRepository;
let repository = null;
function getSecureFileUploadRepository() {
    repository ??= new DatabaseSecureFileUploadRepository();
    return repository;
}
