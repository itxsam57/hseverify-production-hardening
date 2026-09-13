"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseAuditRepository = exports.AUDIT_TENANT_FIND_SQL = exports.AUDIT_TENANT_LIST_SQL = exports.AUDIT_PLATFORM_FIND_SQL = exports.AUDIT_PLATFORM_LIST_SQL = exports.AUDIT_PLATFORM_READ_GUARD_SQL = exports.AUDIT_APPEND_SQL = void 0;
exports.getAuditRepository = getAuditRepository;
const database_1 = require("../database/database");
const tenant_scoped_command_guard_1 = require("../authorization/tenant-scoped-command-guard");
const audit_domain_1 = require("./audit-domain");
exports.AUDIT_APPEND_SQL = `
INSERT INTO platform_audit_events (
  audit_event_id, source_kind, source_event_id,
  actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
  action_key, outcome, reason_key, target_type, target_reference,
  request_fingerprint_hash, metadata, occurred_at, recorded_at
) VALUES (
  $1, 'native', NULL,
  $2, $3, $4, $5,
  $6, $7, $8, $9, $10,
  $11, $12::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
RETURNING audit_sequence, audit_event_id, source_kind, source_event_id,
          actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
          action_key, outcome, reason_key, target_type, target_reference,
          request_fingerprint_hash, metadata, occurred_at, recorded_at`;
exports.AUDIT_PLATFORM_READ_GUARD_SQL = `
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
  AND sessions.active_role IN ('admin', 'root')
  AND accounts.account_status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > $4::timestamptz
FOR UPDATE OF sessions, accounts`;
exports.AUDIT_PLATFORM_LIST_SQL = `
SELECT audit_sequence, audit_event_id, source_kind, source_event_id,
       actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
       action_key, outcome, reason_key, target_type, target_reference,
       request_fingerprint_hash, metadata, occurred_at, recorded_at
FROM platform_audit_events
WHERE ($1::bigint IS NULL OR audit_sequence < $1::bigint)
ORDER BY audit_sequence DESC
LIMIT $2`;
exports.AUDIT_PLATFORM_FIND_SQL = `
SELECT audit_sequence, audit_event_id, source_kind, source_event_id,
       actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
       action_key, outcome, reason_key, target_type, target_reference,
       request_fingerprint_hash, metadata, occurred_at, recorded_at
FROM platform_audit_events
WHERE audit_event_id = $1`;
exports.AUDIT_TENANT_LIST_SQL = `
SELECT audit_sequence, audit_event_id, source_kind, source_event_id,
       actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
       action_key, outcome, reason_key, target_type, target_reference,
       request_fingerprint_hash, metadata, occurred_at, recorded_at
FROM platform_audit_events
WHERE actor_tenant_id = $1
  AND ($2::bigint IS NULL OR audit_sequence < $2::bigint)
ORDER BY audit_sequence DESC
LIMIT $3`;
exports.AUDIT_TENANT_FIND_SQL = `
SELECT audit_sequence, audit_event_id, source_kind, source_event_id,
       actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
       action_key, outcome, reason_key, target_type, target_reference,
       request_fingerprint_hash, metadata, occurred_at, recorded_at
FROM platform_audit_events
WHERE actor_tenant_id = $1
  AND audit_event_id = $2`;
function timestamp(value) {
    return value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
}
function fromRow(row) {
    if (!(0, audit_domain_1.isAuditAction)(row.action_key) ||
        !(0, audit_domain_1.isAuditOutcome)(row.outcome) ||
        !(0, audit_domain_1.isAuditTargetType)(row.target_type)) {
        throw new audit_domain_1.AuditContractError("Stored audit event vocabulary is invalid.");
    }
    const metadata = typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata;
    return Object.freeze({
        sequence: Number(row.audit_sequence),
        auditEventId: row.audit_event_id,
        sourceKind: row.source_kind,
        sourceEventId: row.source_event_id,
        actorAccountId: row.actor_account_id,
        actorRole: row.actor_role,
        actorTenantId: row.actor_tenant_id,
        actorMembershipId: row.actor_membership_id,
        action: row.action_key,
        outcome: row.outcome,
        reason: row.reason_key,
        target: (0, audit_domain_1.normalizeAuditTarget)({
            type: row.target_type,
            reference: row.target_reference
        }),
        requestFingerprintHash: row.request_fingerprint_hash,
        metadata: (0, audit_domain_1.normalizeAuditMetadata)(metadata),
        occurredAt: timestamp(row.occurred_at),
        recordedAt: timestamp(row.recorded_at)
    });
}
class DatabaseAuditRepository {
    clientPromise;
    constructor(clientPromise = (0, database_1.getDatabaseClient)()) {
        this.clientPromise = clientPromise;
    }
    client() {
        return this.clientPromise;
    }
    async append(actorInput, input) {
        const actor = (0, audit_domain_1.assertTrustedAuditActor)(actorInput);
        if (!(0, audit_domain_1.isAuditAction)(input.action) || !(0, audit_domain_1.isAuditOutcome)(input.outcome)) {
            throw new audit_domain_1.AuditContractError("Unknown audit action or outcome.");
        }
        const reason = (0, audit_domain_1.normalizeAuditReason)(input.reason);
        const target = (0, audit_domain_1.normalizeAuditTarget)(input.target);
        const metadata = (0, audit_domain_1.normalizeAuditMetadata)(input.metadata);
        const fingerprint = input.requestFingerprintHash?.trim() || null;
        if (fingerprint && fingerprint.length > 256) {
            throw new audit_domain_1.AuditContractError("Request fingerprint hash is invalid.");
        }
        const database = await this.client();
        const result = await database.query(exports.AUDIT_APPEND_SQL, [
            (0, audit_domain_1.createAuditEventId)(),
            actor.accountId,
            actor.activeRole,
            actor.tenantId,
            actor.membershipId,
            input.action,
            input.outcome,
            reason,
            target.type,
            target.reference,
            fingerprint,
            JSON.stringify(metadata)
        ]);
        const row = result.rows[0];
        if (!row)
            throw new audit_domain_1.AuditContractError("Audit event was not persisted.");
        return fromRow(row);
    }
    async listPlatform(principal, options = {}) {
        const scope = (0, audit_domain_1.derivePlatformAuditReadScope)(principal);
        const cursor = (0, audit_domain_1.normalizeAuditCursor)(options.beforeSequence);
        const limit = (0, audit_domain_1.normalizeAuditLimit)(options.limit);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            const guard = await transaction.query(exports.AUDIT_PLATFORM_READ_GUARD_SQL, [
                scope.sessionId,
                scope.accountId,
                scope.activeRole,
                new Date().toISOString()
            ]);
            if (guard.rows[0]?.session_id !== scope.sessionId) {
                throw new audit_domain_1.AuditReadDeniedError();
            }
            const result = await transaction.query(exports.AUDIT_PLATFORM_LIST_SQL, [cursor, limit]);
            return Object.freeze(result.rows.map(fromRow));
        });
    }
    async findPlatformById(principal, auditEventId) {
        const scope = (0, audit_domain_1.derivePlatformAuditReadScope)(principal);
        const database = await this.client();
        return database.transaction(async (transaction) => {
            const guard = await transaction.query(exports.AUDIT_PLATFORM_READ_GUARD_SQL, [
                scope.sessionId,
                scope.accountId,
                scope.activeRole,
                new Date().toISOString()
            ]);
            if (guard.rows[0]?.session_id !== scope.sessionId) {
                throw new audit_domain_1.AuditReadDeniedError();
            }
            const result = await transaction.query(exports.AUDIT_PLATFORM_FIND_SQL, [auditEventId]);
            return result.rows[0] ? fromRow(result.rows[0]) : null;
        });
    }
    async listTenant(principal, options = {}) {
        (0, audit_domain_1.assertTenantAuditReadPrincipal)(principal);
        const cursor = (0, audit_domain_1.normalizeAuditCursor)(options.beforeSequence);
        const limit = (0, audit_domain_1.normalizeAuditLimit)(options.limit);
        return (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
            database: await this.client(),
            principal,
            permission: "company.audit.read",
            operation: async ({ database, scope }) => {
                const result = await database.query(exports.AUDIT_TENANT_LIST_SQL, [
                    scope.tenantId,
                    cursor,
                    limit
                ]);
                return Object.freeze(result.rows.map(fromRow));
            }
        });
    }
    async findTenantById(principal, auditEventId) {
        (0, audit_domain_1.assertTenantAuditReadPrincipal)(principal);
        return (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
            database: await this.client(),
            principal,
            permission: "company.audit.read",
            operation: async ({ database, scope }) => {
                const result = await database.query(exports.AUDIT_TENANT_FIND_SQL, [
                    scope.tenantId,
                    auditEventId
                ]);
                return result.rows[0] ? fromRow(result.rows[0]) : null;
            }
        });
    }
}
exports.DatabaseAuditRepository = DatabaseAuditRepository;
let repository = null;
function getAuditRepository() {
    repository ??= new DatabaseAuditRepository();
    return repository;
}
