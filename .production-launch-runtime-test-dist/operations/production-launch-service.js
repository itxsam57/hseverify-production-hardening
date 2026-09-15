"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductionLaunchService = exports.ReleaseHandoverConflictError = exports.ReleaseHandoverAccessError = exports.ReleaseHandoverInputError = void 0;
exports.getProductionLaunchService = getProductionLaunchService;
const audit_domain_1 = require("../audit/audit-domain");
const audit_repository_1 = require("../audit/audit-repository");
const database_1 = require("../database/database");
const production_launch_domain_1 = require("./production-launch-domain");
const CHECK_NAMES = ["runbook", "support", "alerts", "rollback", "acceptance"];
const CHECK_STATUSES = ["passed", "failed", "pending"];
class ReleaseHandoverInputError extends Error {
    constructor(message = "Release handover input is invalid.") {
        super(message);
        this.name = "ReleaseHandoverInputError";
    }
}
exports.ReleaseHandoverInputError = ReleaseHandoverInputError;
class ReleaseHandoverAccessError extends Error {
    constructor() {
        super("Release handover access is denied.");
        this.name = "ReleaseHandoverAccessError";
    }
}
exports.ReleaseHandoverAccessError = ReleaseHandoverAccessError;
class ReleaseHandoverConflictError extends Error {
    constructor() {
        super("Release handover state changed. Reload and try again.");
        this.name = "ReleaseHandoverConflictError";
    }
}
exports.ReleaseHandoverConflictError = ReleaseHandoverConflictError;
function isCheckName(value) {
    return typeof value === "string" && CHECK_NAMES.includes(value);
}
function isCheckStatus(value) {
    return typeof value === "string" && CHECK_STATUSES.includes(value);
}
function timestamp(value) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function persistedCheck(row) {
    if (!isCheckName(row.check_name) || !isCheckStatus(row.status)) {
        throw new Error("Stored release handover state is invalid.");
    }
    const revision = Number(row.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new Error("Stored release handover revision is invalid.");
    }
    return Object.freeze({
        name: row.check_name,
        status: row.status,
        revision,
        updatedByAccountId: row.updated_by_account_id,
        updatedAt: timestamp(row.updated_at)
    });
}
async function requireLiveAdmin(database, principal, now) {
    if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
        throw new ReleaseHandoverAccessError();
    }
    const result = await database.query(`SELECT sessions.session_id
     FROM auth_sessions AS sessions
     JOIN auth_accounts AS accounts ON accounts.account_id = sessions.account_id
     JOIN auth_account_roles AS roles
       ON roles.account_id = accounts.account_id
      AND roles.role = 'admin'
     WHERE sessions.session_id = $1
       AND sessions.account_id = $2
       AND sessions.active_role = 'admin'
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > $3::timestamptz
       AND accounts.account_status = 'active'
     FOR UPDATE OF sessions, accounts`, [principal.sessionId, principal.accountId, now.toISOString()]);
    if (!result.rows[0])
        throw new ReleaseHandoverAccessError();
}
async function readPersistedReadiness(database) {
    const result = await database.query(`SELECT check_name, status, revision, updated_by_account_id, updated_at
     FROM production_release_handover_checks
     ORDER BY CASE check_name
       WHEN 'runbook' THEN 1
       WHEN 'support' THEN 2
       WHEN 'alerts' THEN 3
       WHEN 'rollback' THEN 4
       WHEN 'acceptance' THEN 5
       ELSE 6
     END`);
    const checks = result.rows.map(persistedCheck);
    const release = (0, production_launch_domain_1.buildReleaseReadinessSnapshot)(checks.map(({ name, status }) => ({ name, status })));
    return Object.freeze({
        status: release.status,
        checks: Object.freeze(checks),
        generatedAt: release.generatedAt
    });
}
function validateUpdateInput(input) {
    if (!isCheckName(input.name) ||
        !isCheckStatus(input.status) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        Number(input.expectedRevision) < 0) {
        throw new ReleaseHandoverInputError();
    }
    return {
        name: input.name,
        status: input.status,
        expectedRevision: Number(input.expectedRevision)
    };
}
class ProductionLaunchService {
    database;
    constructor(database) {
        this.database = database;
    }
    async getReadiness(principal, now = new Date()) {
        return this.database.transaction(async (database) => {
            await requireLiveAdmin(database, principal, now);
            return readPersistedReadiness(database);
        });
    }
    async updateCheck(principal, input, now = new Date()) {
        const update = validateUpdateInput(input);
        return this.database.transaction(async (database) => {
            await requireLiveAdmin(database, principal, now);
            const result = await database.query(`UPDATE production_release_handover_checks
         SET status = $2,
             revision = revision + 1,
             updated_by_account_id = $3,
             updated_at = $4::timestamptz
         WHERE check_name = $1
           AND revision = $5
         RETURNING check_name, status, revision, updated_by_account_id, updated_at`, [update.name, update.status, principal.accountId, now.toISOString(), update.expectedRevision]);
            const changed = result.rows[0];
            if (!changed)
                throw new ReleaseHandoverConflictError();
            const persisted = persistedCheck(changed);
            await new audit_repository_1.DatabaseAuditRepository(Promise.resolve(database)).append((0, audit_domain_1.bindTrustedAuditActor)(principal), {
                action: "production_launch.handover.updated",
                outcome: "succeeded",
                target: { type: "platform", reference: persisted.name },
                metadata: {
                    status: persisted.status,
                    revision: persisted.revision
                }
            });
            return readPersistedReadiness(database);
        });
    }
}
exports.ProductionLaunchService = ProductionLaunchService;
async function getProductionLaunchService() {
    return new ProductionLaunchService(await (0, database_1.getDatabaseClient)());
}
