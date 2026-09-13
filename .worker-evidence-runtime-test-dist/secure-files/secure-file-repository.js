"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseSecureFileRepository = exports.SECURE_FILE_FIND_SQL = exports.SECURE_FILE_LIST_SQL = exports.SECURE_FILE_COMPANY_APPLICATION_SCOPE_GUARD_SQL = exports.SECURE_FILE_COMPANY_SCOPE_GUARD_SQL = exports.SECURE_FILE_SESSION_GUARD_SQL = exports.SECURE_FILE_FIND_RESERVATION_SQL = exports.SECURE_FILE_RESERVE_SQL = void 0;
exports.getSecureFileRepository = getSecureFileRepository;
const database_1 = require("../database/database");
const secure_file_domain_1 = require("./secure-file-domain");
exports.SECURE_FILE_RESERVE_SQL = `
INSERT INTO platform_secure_files (
  file_id, schema_version, reservation_key,
  owner_account_id, owner_role, tenant_id, membership_id,
  storage_adapter_key, object_key, display_filename
) VALUES (
  $1, $2, $3,
  $4, $5, $6, $7,
  $8, $9, $10
)
ON CONFLICT (reservation_key) DO NOTHING
RETURNING *`;
exports.SECURE_FILE_FIND_RESERVATION_SQL = `
SELECT *
FROM platform_secure_files
WHERE reservation_key = $1
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
  )`;
exports.SECURE_FILE_SESSION_GUARD_SQL = `
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
exports.SECURE_FILE_COMPANY_SCOPE_GUARD_SQL = `
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
exports.SECURE_FILE_COMPANY_APPLICATION_SCOPE_GUARD_SQL = `
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
exports.SECURE_FILE_LIST_SQL = `
SELECT *
FROM platform_secure_files
WHERE owner_account_id = $1
  AND owner_role = $2
  AND (
    (
      $2 = 'company'
      AND tenant_id = $3
      AND membership_id = $4
    ) OR (
      $2 <> 'company'
      AND tenant_id IS NULL
      AND membership_id IS NULL
    )
  )
  AND ($5::bigint IS NULL OR file_sequence < $5::bigint)
ORDER BY file_sequence DESC
LIMIT $6`;
exports.SECURE_FILE_FIND_SQL = `
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
  )`;
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
function secureFileFromRow(row) {
    if (Number(row.schema_version) !== secure_file_domain_1.SECURE_FILE_SCHEMA_VERSION ||
        !(0, secure_file_domain_1.isSecureFileLifecycleStatus)(row.lifecycle_status) ||
        !(0, secure_file_domain_1.isSecureFileStorageAdapterKey)(row.storage_adapter_key) ||
        !validExtension(row.file_extension) ||
        !validMime(row.declared_mime) ||
        !validMime(row.detected_mime) ||
        !(0, secure_file_domain_1.normalizeSecureFileReference)(row.file_id)) {
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
function scopeParameters(principal) {
    const membership = principal.tenantMembership;
    return [
        principal.accountId,
        principal.activeRole,
        membership?.tenantId ?? null,
        membership?.membershipId ?? null
    ];
}
function ownerScopeParameters(owner) {
    return [owner.accountId, owner.role, owner.tenantId, owner.membershipId];
}
async function assertLiveScope(database, input) {
    const session = await database.query(exports.SECURE_FILE_SESSION_GUARD_SQL, [input.sessionId, input.accountId, input.role]);
    if (session.rows[0]?.session_id !== input.sessionId) {
        throw new secure_file_domain_1.SecureFileAccessDeniedError();
    }
    if (input.role === "company") {
        if (!input.tenantId || !input.membershipId) {
            throw new secure_file_domain_1.SecureFileAccessDeniedError();
        }
        const sql = input.authorityMode === "company_application"
            ? exports.SECURE_FILE_COMPANY_APPLICATION_SCOPE_GUARD_SQL
            : exports.SECURE_FILE_COMPANY_SCOPE_GUARD_SQL;
        const membership = await database.query(sql, [input.membershipId, input.tenantId, input.accountId]);
        if (membership.rows[0]?.membership_id !== input.membershipId) {
            throw new secure_file_domain_1.SecureFileAccessDeniedError();
        }
    }
    else if (input.tenantId !== null ||
        input.membershipId !== null ||
        input.authorityMode !== "active_tenant") {
        throw new secure_file_domain_1.SecureFileAccessDeniedError();
    }
}
async function assertLivePrincipal(database, principal) {
    const membership = principal.tenantMembership;
    await assertLiveScope(database, {
        sessionId: principal.sessionId,
        accountId: principal.accountId,
        role: principal.activeRole,
        tenantId: membership?.tenantId ?? null,
        membershipId: membership?.membershipId ?? null,
        authorityMode: "active_tenant"
    });
}
class DatabaseSecureFileRepository {
    clientPromise;
    constructor(clientPromise = (0, database_1.getDatabaseClient)()) {
        this.clientPromise = clientPromise;
    }
    client() {
        return this.clientPromise;
    }
    async reserve(ownerInput, intentInput) {
        const owner = (0, secure_file_domain_1.assertTrustedSecureFileOwner)(ownerInput);
        const intent = (0, secure_file_domain_1.assertTrustedSecureFileReservationIntent)(intentInput);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            await assertLiveScope(transaction, {
                sessionId: owner.sessionId,
                accountId: owner.accountId,
                role: owner.role,
                tenantId: owner.tenantId,
                membershipId: owner.membershipId,
                authorityMode: owner.authorityMode
            });
            const fileId = (0, secure_file_domain_1.createSecureFileId)();
            const objectKey = (0, secure_file_domain_1.deriveSecureFileObjectKey)(fileId);
            const inserted = await transaction.query(exports.SECURE_FILE_RESERVE_SQL, [
                fileId,
                secure_file_domain_1.SECURE_FILE_SCHEMA_VERSION,
                intent.reservationKey,
                owner.accountId,
                owner.role,
                owner.tenantId,
                owner.membershipId,
                "local_test",
                objectKey,
                intent.displayFilename
            ]);
            let row = inserted.rows[0];
            let created = true;
            if (!row) {
                created = false;
                const existing = await transaction.query(exports.SECURE_FILE_FIND_RESERVATION_SQL, [intent.reservationKey, ...ownerScopeParameters(owner)]);
                row = existing.rows[0];
                if (!row)
                    throw new secure_file_domain_1.SecureFileReservationConflictError();
            }
            const file = secureFileFromRow(row);
            if (file.reservationKey !== intent.reservationKey ||
                file.ownerAccountId !== owner.accountId ||
                file.ownerRole !== owner.role ||
                file.tenantId !== owner.tenantId ||
                file.membershipId !== owner.membershipId ||
                file.displayFilename !== intent.displayFilename ||
                file.storageAdapterKey !== "local_test" ||
                file.objectKey !== (0, secure_file_domain_1.deriveSecureFileObjectKey)(file.fileId) ||
                file.lifecycleStatus !== "reserved") {
                throw new secure_file_domain_1.SecureFileReservationConflictError();
            }
            return Object.freeze({ created, file });
        });
    }
    async listForPrincipal(principal, options = {}) {
        const cursor = (0, secure_file_domain_1.normalizeSecureFileCursor)(options.beforeSequence);
        const limit = (0, secure_file_domain_1.normalizeSecureFileLimit)(options.limit);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            await assertLivePrincipal(transaction, principal);
            const result = await transaction.query(exports.SECURE_FILE_LIST_SQL, [...scopeParameters(principal), cursor, limit]);
            return Object.freeze(result.rows.map(secureFileFromRow));
        });
    }
    async findForPrincipal(principal, fileIdInput) {
        const fileId = (0, secure_file_domain_1.normalizeSecureFileReference)(fileIdInput);
        if (!fileId)
            return null;
        const database = await this.client();
        return database.transaction(async (transaction) => {
            await assertLivePrincipal(transaction, principal);
            const result = await transaction.query(exports.SECURE_FILE_FIND_SQL, [fileId, ...scopeParameters(principal)]);
            return result.rows[0] ? secureFileFromRow(result.rows[0]) : null;
        });
    }
    async findForTrustedOwner(ownerInput, fileIdInput) {
        const owner = (0, secure_file_domain_1.assertTrustedSecureFileOwner)(ownerInput);
        const fileId = (0, secure_file_domain_1.normalizeSecureFileReference)(fileIdInput);
        if (!fileId)
            return null;
        const database = await this.client();
        return database.transaction(async (transaction) => {
            await assertLiveScope(transaction, {
                sessionId: owner.sessionId,
                accountId: owner.accountId,
                role: owner.role,
                tenantId: owner.tenantId,
                membershipId: owner.membershipId,
                authorityMode: owner.authorityMode
            });
            const result = await transaction.query(exports.SECURE_FILE_FIND_SQL, [fileId, ...ownerScopeParameters(owner)]);
            return result.rows[0] ? secureFileFromRow(result.rows[0]) : null;
        });
    }
}
exports.DatabaseSecureFileRepository = DatabaseSecureFileRepository;
let repository = null;
function getSecureFileRepository() {
    repository ??= new DatabaseSecureFileRepository();
    return repository;
}
