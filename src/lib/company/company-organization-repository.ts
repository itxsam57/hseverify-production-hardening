import "server-only";

import { bindTrustedAuditActor, type AuditAction } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import type { TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";
import {
  CompanyOrganizationConflictError,
  CompanyOrganizationNotFoundError,
  createCompanyDepartmentId,
  createCompanySiteId,
  normalizeCompanyUnitDraft,
  normalizeCompanyUnitRevision,
  type CompanyUnitDraftInput,
  type CompanyUnitKind,
  type CompanyUnitRecord
} from "./company-organization-domain";

const READ_PERMISSION = "company.tenant.read" as const;
const WRITE_PERMISSION = "company.settings.manage" as const;

type Timestamp = string | Date;
type UnitRow = {
  unit_id: string;
  tenant_id: string;
  name: string;
  formatted_address: string;
  phone: string;
  website: string;
  email_normalized: string;
  registration_number: string | null;
  unit_status: "active" | "archived";
  revision: number | string;
  created_by_membership_id: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
};

function timestamp(value: Timestamp): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function optionalTimestamp(value: Timestamp | null): string | null {
  return value === null ? null : timestamp(value);
}
function record(kind: CompanyUnitKind, row: UnitRow): CompanyUnitRecord {
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
function table(kind: CompanyUnitKind): "company_sites" | "company_departments" {
  return kind === "site" ? "company_sites" : "company_departments";
}
function idColumn(kind: CompanyUnitKind): "site_id" | "department_id" {
  return kind === "site" ? "site_id" : "department_id";
}
function statusColumn(kind: CompanyUnitKind): "site_status" | "department_status" {
  return kind === "site" ? "site_status" : "department_status";
}
function columns(kind: CompanyUnitKind): string {
  const id = idColumn(kind);
  const status = statusColumn(kind);
  return `${id} AS unit_id, tenant_id, name, formatted_address, phone, website,
    email_normalized, registration_number, ${status} AS unit_status, revision,
    created_by_membership_id, created_at, updated_at, archived_at`;
}
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

async function appendAudit(input: {
  database: DatabaseClient;
  principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>;
  action: AuditAction;
  unit: CompanyUnitRecord;
}): Promise<void> {
  const audit = new DatabaseAuditRepository(Promise.resolve(input.database));
  await audit.append(bindTrustedAuditActor(input.principal), {
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

export interface CompanyOrganizationRepository {
  list(principal: TenantPermissionPrincipal<typeof READ_PERMISSION>, kind: CompanyUnitKind): Promise<readonly CompanyUnitRecord[]>;
  create(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, input: CompanyUnitDraftInput): Promise<CompanyUnitRecord>;
  update(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, unitId: string, expectedRevision: number, input: CompanyUnitDraftInput): Promise<CompanyUnitRecord>;
  archive(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, unitId: string, expectedRevision: number): Promise<CompanyUnitRecord>;
  restore(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, unitId: string, expectedRevision: number): Promise<CompanyUnitRecord>;
}

export class DatabaseCompanyOrganizationRepository implements CompanyOrganizationRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()) {}
  private client(): Promise<DatabaseClient> { return this.clientPromise; }

  async list(principal: TenantPermissionPrincipal<typeof READ_PERMISSION>, kind: CompanyUnitKind): Promise<readonly CompanyUnitRecord[]> {
    return runTenantScopedCommand({
      database: await this.client(), principal, permission: READ_PERMISSION,
      operation: async ({ database, scope }) => {
        const result = await database.query<UnitRow>(
          `SELECT ${columns(kind)} FROM ${table(kind)} WHERE tenant_id = $1 ORDER BY CASE WHEN ${statusColumn(kind)} = 'active' THEN 0 ELSE 1 END, lower(name), ${idColumn(kind)}`,
          [scope.tenantId]
        );
        return Object.freeze(result.rows.map((row) => record(kind, row)));
      }
    });
  }

  async create(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, input: CompanyUnitDraftInput): Promise<CompanyUnitRecord> {
    const draft = normalizeCompanyUnitDraft(input);
    try {
      return await runTenantScopedCommand({
        database: await this.client(), principal, permission: WRITE_PERMISSION,
        operation: async ({ database, scope }) => {
          const id = kind === "site" ? createCompanySiteId() : createCompanyDepartmentId();
          const result = await database.query<UnitRow>(
            `INSERT INTO ${table(kind)} (${idColumn(kind)}, tenant_id, name, formatted_address, phone, website, email_normalized, registration_number, created_by_membership_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING ${columns(kind)}`,
            [id, scope.tenantId, draft.name, draft.formattedAddress, draft.phone, draft.website, draft.email, draft.registrationNumber, scope.membershipId]
          );
          const row = result.rows[0];
          if (!row) throw new CompanyOrganizationConflictError();
          const created = record(kind, row);
          await appendAudit({ database, principal, action: "company_organization.created", unit: created });
          return created;
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new CompanyOrganizationConflictError("An active Company unit already uses that name.");
      throw error;
    }
  }

  async update(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, unitId: string, expectedRevision: number, input: CompanyUnitDraftInput): Promise<CompanyUnitRecord> {
    const draft = normalizeCompanyUnitDraft(input);
    const revision = normalizeCompanyUnitRevision(expectedRevision);
    try {
      return await runTenantScopedCommand({
        database: await this.client(), principal, permission: WRITE_PERMISSION,
        operation: async ({ database, scope }) => {
          const result = await database.query<UnitRow>(
            `UPDATE ${table(kind)} SET name=$4, formatted_address=$5, phone=$6, website=$7, email_normalized=$8, registration_number=$9, revision=revision+1, updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=$1 AND ${idColumn(kind)}=$2 AND revision=$3 AND ${statusColumn(kind)}='active'
             RETURNING ${columns(kind)}`,
            [scope.tenantId, unitId, revision, draft.name, draft.formattedAddress, draft.phone, draft.website, draft.email, draft.registrationNumber]
          );
          const row = result.rows[0];
          if (row) {
            const updated = record(kind, row);
            await appendAudit({ database, principal, action: "company_organization.updated", unit: updated });
            return updated;
          }
          const exists = await database.query<{ present: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM ${table(kind)} WHERE tenant_id=$1 AND ${idColumn(kind)}=$2) AS present`,
            [scope.tenantId, unitId]
          );
          if (!exists.rows[0]?.present) throw new CompanyOrganizationNotFoundError();
          throw new CompanyOrganizationConflictError("Only the current active Company unit revision can be edited.");
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new CompanyOrganizationConflictError("An active Company unit already uses that name.");
      throw error;
    }
  }

  private async transition(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, unitId: string, expectedRevision: number, target: "active" | "archived"): Promise<CompanyUnitRecord> {
    const revision = normalizeCompanyUnitRevision(expectedRevision);
    return runTenantScopedCommand({
      database: await this.client(), principal, permission: WRITE_PERMISSION,
      operation: async ({ database, scope }) => {
        const source = target === "archived" ? "active" : "archived";
        const archivedExpression = target === "archived" ? "CURRENT_TIMESTAMP" : "NULL";
        const result = await database.query<UnitRow>(
          `UPDATE ${table(kind)} SET ${statusColumn(kind)}='${target}', archived_at=${archivedExpression}, revision=revision+1, updated_at=CURRENT_TIMESTAMP
           WHERE tenant_id=$1 AND ${idColumn(kind)}=$2 AND revision=$3 AND ${statusColumn(kind)}='${source}'
           RETURNING ${columns(kind)}`,
          [scope.tenantId, unitId, revision]
        );
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
        const exists = await database.query<{ present: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM ${table(kind)} WHERE tenant_id=$1 AND ${idColumn(kind)}=$2) AS present`,
          [scope.tenantId, unitId]
        );
        if (!exists.rows[0]?.present) throw new CompanyOrganizationNotFoundError();
        throw new CompanyOrganizationConflictError();
      }
    });
  }

  archive(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, unitId: string, expectedRevision: number): Promise<CompanyUnitRecord> {
    return this.transition(principal, kind, unitId, expectedRevision, "archived");
  }
  restore(principal: TenantPermissionPrincipal<typeof WRITE_PERMISSION>, kind: CompanyUnitKind, unitId: string, expectedRevision: number): Promise<CompanyUnitRecord> {
    return this.transition(principal, kind, unitId, expectedRevision, "active");
  }
}

let repository: CompanyOrganizationRepository | null = null;
export function getCompanyOrganizationRepository(): CompanyOrganizationRepository {
  repository ??= new DatabaseCompanyOrganizationRepository();
  return repository;
}
