"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseCompanyOrganizationRepository = void 0;
exports.getCompanyOrganizationRepository = getCompanyOrganizationRepository;
const audit_domain_1 = require("../audit/audit-domain");
const audit_repository_1 = require("../audit/audit-repository");
const database_1 = require("../database/database");
const tenant_scoped_command_guard_1 = require("../authorization/tenant-scoped-command-guard");
const company_organization_domain_1 = require("./company-organization-domain");
const READ_PERMISSION = "company.tenant.read";
const WRITE_PERMISSION = "company.settings.manage";
function timestamp(value) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function optionalTimestamp(value) {
    return value === null ? null : timestamp(value);
}
function record(kind, row) {
    return Object.freeze({
        kind,
        unitId: row.unit_id,
        tenantId: row.tenant_id,
        name: row.name,
        formattedAddress: row.formatted_address,
        phone: row.phone,
        website: row.website,
        email: row.email_normalized,
        registrationNumber: row.registration_number,
        status: row.unit_status,
        revision: Number(row.revision),
        createdByMembershipId: row.created_by_membership_id,
        createdAt: timestamp(row.created_at),
        updatedAt: timestamp(row.updated_at),
        archivedAt: optionalTimestamp(row.archived_at)
    });
}
function table(kind) {
    return kind === "site" ? "company_sites" : "company_departments";
}
function idColumn(kind) {
    return kind === "site" ? "site_id" : "department_id";
}
function statusColumn(kind) {
    return kind === "site" ? "site_status" : "department_status";
}
function columns(kind) {
    const id = idColumn(kind);
    const status = statusColumn(kind);
    return `${id} AS unit_id, tenant_id, name, formatted_address, phone, website,
    email_normalized, registration_number, ${status} AS unit_status, revision,
    created_by_membership_id, created_at, updated_at, archived_at`;
}
function isUniqueViolation(error) {
    return Boolean(error && typeof error === "object" && error.code === "23505");
}
async function appendAudit(input) {
    const audit = new audit_repository_1.DatabaseAuditRepository(Promise.resolve(input.database));
    await audit.append((0, audit_domain_1.bindTrustedAuditActor)(input.principal), {
        action: input.action,
        outcome: "succeeded",
        target: { type: "resource", reference: input.unit.unitId },
        metadata: {
            unitKind: input.unit.kind,
            status: input.unit.status,
            revision: input.unit.revision
        }
    });
}
class DatabaseCompanyOrganizationRepository {
    clientPromise;
    constructor(clientPromise = (0, database_1.getDatabaseClient)()) {
        this.clientPromise = clientPromise;
    }
    client() { return this.clientPromise; }
    async list(principal, kind) {
        return (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
            database: await this.client(), principal, permission: READ_PERMISSION,
            operation: async ({ database, scope }) => {
                const result = await database.query(`SELECT ${columns(kind)} FROM ${table(kind)} WHERE tenant_id = $1 ORDER BY CASE WHEN ${statusColumn(kind)} = 'active' THEN 0 ELSE 1 END, lower(name), ${idColumn(kind)}`, [scope.tenantId]);
                return Object.freeze(result.rows.map((row) => record(kind, row)));
            }
        });
    }
    async create(principal, kind, input) {
        const draft = (0, company_organization_domain_1.normalizeCompanyUnitDraft)(input);
        try {
            return await (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
                database: await this.client(), principal, permission: WRITE_PERMISSION,
                operation: async ({ database, scope }) => {
                    const id = kind === "site" ? (0, company_organization_domain_1.createCompanySiteId)() : (0, company_organization_domain_1.createCompanyDepartmentId)();
                    const result = await database.query(`INSERT INTO ${table(kind)} (${idColumn(kind)}, tenant_id, name, formatted_address, phone, website, email_normalized, registration_number, created_by_membership_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING ${columns(kind)}`, [id, scope.tenantId, draft.name, draft.formattedAddress, draft.phone, draft.website, draft.email, draft.registrationNumber, scope.membershipId]);
                    const row = result.rows[0];
                    if (!row)
                        throw new company_organization_domain_1.CompanyOrganizationConflictError();
                    const created = record(kind, row);
                    await appendAudit({ database, principal, action: "company_organization.created", unit: created });
                    return created;
                }
            });
        }
        catch (error) {
            if (isUniqueViolation(error))
                throw new company_organization_domain_1.CompanyOrganizationConflictError("An active Company unit already uses that name.");
            throw error;
        }
    }
    async update(principal, kind, unitId, expectedRevision, input) {
        const draft = (0, company_organization_domain_1.normalizeCompanyUnitDraft)(input);
        const revision = (0, company_organization_domain_1.normalizeCompanyUnitRevision)(expectedRevision);
        try {
            return await (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
                database: await this.client(), principal, permission: WRITE_PERMISSION,
                operation: async ({ database, scope }) => {
                    const result = await database.query(`UPDATE ${table(kind)} SET name=$4, formatted_address=$5, phone=$6, website=$7, email_normalized=$8, registration_number=$9, revision=revision+1, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=$1 AND ${idColumn(kind)}=$2 AND revision=$3 AND ${statusColumn(kind)}='active'
             RETURNING ${columns(kind)}`, [scope.tenantId, unitId, revision, draft.name, draft.formattedAddress, draft.phone, draft.website, draft.email, draft.registrationNumber]);
                    const row = result.rows[0];
                    if (row) {
                        const updated = record(kind, row);
                        await appendAudit({ database, principal, action: "company_organization.updated", unit: updated });
                        return updated;
                    }
                    const exists = await database.query(`SELECT EXISTS(SELECT 1 FROM ${table(kind)} WHERE tenant_id=$1 AND ${idColumn(kind)}=$2) AS present`, [scope.tenantId, unitId]);
                    if (!exists.rows[0]?.present)
                        throw new company_organization_domain_1.CompanyOrganizationNotFoundError();
                    throw new company_organization_domain_1.CompanyOrganizationConflictError("Only the current active Company unit revision can be edited.");
                }
            });
        }
        catch (error) {
            if (isUniqueViolation(error))
                throw new company_organization_domain_1.CompanyOrganizationConflictError("An active Company unit already uses that name.");
            throw error;
        }
    }
    async transition(principal, kind, unitId, expectedRevision, target) {
        const revision = (0, company_organization_domain_1.normalizeCompanyUnitRevision)(expectedRevision);
        return (0, tenant_scoped_command_guard_1.runTenantScopedCommand)({
            database: await this.client(), principal, permission: WRITE_PERMISSION,
            operation: async ({ database, scope }) => {
                const source = target === "archived" ? "active" : "archived";
                const archivedExpression = target === "archived" ? "CURRENT_TIMESTAMP" : "NULL";
                const result = await database.query(`UPDATE ${table(kind)} SET ${statusColumn(kind)}='${target}', archived_at=${archivedExpression}, revision=revision+1, updated_at=CURRENT_TIMESTAMP
           WHERE tenant_id=$1 AND ${idColumn(kind)}=$2 AND revision=$3 AND ${statusColumn(kind)}='${source}'
           RETURNING ${columns(kind)}`, [scope.tenantId, unitId, revision]);
                const row = result.rows[0];
                if (row) {
                    const transitioned = record(kind, row);
                    await appendAudit({
                        database,
                        principal,
                        action: target === "archived" ? "company_organization.archived" : "company_organization.restored",
                        unit: transitioned
                    });
                    return transitioned;
                }
                const exists = await database.query(`SELECT EXISTS(SELECT 1 FROM ${table(kind)} WHERE tenant_id=$1 AND ${idColumn(kind)}=$2) AS present`, [scope.tenantId, unitId]);
                if (!exists.rows[0]?.present)
                    throw new company_organization_domain_1.CompanyOrganizationNotFoundError();
                throw new company_organization_domain_1.CompanyOrganizationConflictError();
            }
        });
    }
    archive(principal, kind, unitId, expectedRevision) {
        return this.transition(principal, kind, unitId, expectedRevision, "archived");
    }
    restore(principal, kind, unitId, expectedRevision) {
        return this.transition(principal, kind, unitId, expectedRevision, "active");
    }
}
exports.DatabaseCompanyOrganizationRepository = DatabaseCompanyOrganizationRepository;
let repository = null;
function getCompanyOrganizationRepository() {
    repository ??= new DatabaseCompanyOrganizationRepository();
    return repository;
}
