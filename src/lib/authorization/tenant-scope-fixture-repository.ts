import "server-only";

import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import { runTenantScopedCommand } from "./tenant-scoped-command-guard";
import {
  TENANT_SCOPE_FIXTURE_READ_PERMISSION,
  TENANT_SCOPE_FIXTURE_WRITE_PERMISSION,
  TenantScopeConflictError,
  createTenantScopeFixtureId,
  normalizeTenantScopeFixtureKey,
  normalizeTenantScopeFixturePayload,
  type TenantPermissionPrincipal,
  type TenantScopeFixtureRecord
} from "./tenant-scoped-resource-domain";

export const TENANT_SCOPE_FIXTURE_LIST_SQL = `
SELECT fixture_id, tenant_id, record_key, payload, version,
       created_by_membership_id, created_at, updated_at
FROM authorization_tenant_scope_fixtures
WHERE tenant_id = $1
ORDER BY updated_at DESC, fixture_id`;

export const TENANT_SCOPE_FIXTURE_FIND_SQL = `
SELECT fixture_id, tenant_id, record_key, payload, version,
       created_by_membership_id, created_at, updated_at
FROM authorization_tenant_scope_fixtures
WHERE tenant_id = $1 AND fixture_id = $2`;

export const TENANT_SCOPE_FIXTURE_INSERT_SQL = `
INSERT INTO authorization_tenant_scope_fixtures (
  fixture_id, tenant_id, record_key, payload, version,
  created_by_membership_id, created_at, updated_at
) VALUES ($1, $2, $3, $4::jsonb, 1, $5, $6, $6)
ON CONFLICT (tenant_id, record_key) DO NOTHING
RETURNING fixture_id, tenant_id, record_key, payload, version,
          created_by_membership_id, created_at, updated_at`;

export const TENANT_SCOPE_FIXTURE_UPDATE_SQL = `
UPDATE authorization_tenant_scope_fixtures
SET record_key = $3,
    payload = $4::jsonb,
    version = version + 1,
    updated_at = $6
WHERE tenant_id = $1
  AND fixture_id = $2
  AND version = $5
RETURNING fixture_id, tenant_id, record_key, payload, version,
          created_by_membership_id, created_at, updated_at`;

export const TENANT_SCOPE_FIXTURE_DELETE_SQL = `
DELETE FROM authorization_tenant_scope_fixtures
WHERE tenant_id = $1 AND fixture_id = $2
RETURNING fixture_id`;

type TenantScopeFixtureRow = {
  fixture_id: string;
  tenant_id: string;
  record_key: string;
  payload: unknown;
  version: number;
  created_by_membership_id: string;
  created_at: string | Date;
  updated_at: string | Date;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function fixtureFromRow(row: TenantScopeFixtureRow): TenantScopeFixtureRecord {
  const payload =
    typeof row.payload === "string"
      ? (JSON.parse(row.payload) as unknown)
      : row.payload;
  return Object.freeze({
    fixtureId: row.fixture_id,
    tenantId: row.tenant_id,
    recordKey: row.record_key,
    payload: normalizeTenantScopeFixturePayload(payload),
    version: row.version,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at)
  });
}

export interface TenantScopeFixtureRepository {
  list(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_READ_PERMISSION
    >
  ): Promise<readonly TenantScopeFixtureRecord[]>;
  findById(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_READ_PERMISSION
    >,
    fixtureId: string
  ): Promise<TenantScopeFixtureRecord | null>;
  create(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
    >,
    input: { recordKey: string; payload: unknown; now?: Date }
  ): Promise<TenantScopeFixtureRecord>;
  update(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
    >,
    input: {
      fixtureId: string;
      expectedVersion: number;
      recordKey: string;
      payload: unknown;
      now?: Date;
    }
  ): Promise<TenantScopeFixtureRecord>;
  delete(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
    >,
    fixtureId: string,
    now?: Date
  ): Promise<boolean>;
}

export class DatabaseTenantScopeFixtureRepository
  implements TenantScopeFixtureRepository
{
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async list(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_READ_PERMISSION
    >
  ): Promise<readonly TenantScopeFixtureRecord[]> {
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: TENANT_SCOPE_FIXTURE_READ_PERMISSION,
      operation: async ({ database, scope }) => {
        const result = await database.query<TenantScopeFixtureRow>(
          TENANT_SCOPE_FIXTURE_LIST_SQL,
          [scope.tenantId]
        );
        return result.rows.map(fixtureFromRow);
      }
    });
  }

  async findById(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_READ_PERMISSION
    >,
    fixtureId: string
  ): Promise<TenantScopeFixtureRecord | null> {
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: TENANT_SCOPE_FIXTURE_READ_PERMISSION,
      operation: async ({ database, scope }) => {
        const result = await database.query<TenantScopeFixtureRow>(
          TENANT_SCOPE_FIXTURE_FIND_SQL,
          [scope.tenantId, fixtureId]
        );
        const row = result.rows[0];
        return row ? fixtureFromRow(row) : null;
      }
    });
  }

  async create(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
    >,
    input: { recordKey: string; payload: unknown; now?: Date }
  ): Promise<TenantScopeFixtureRecord> {
    const recordKey = normalizeTenantScopeFixtureKey(input.recordKey);
    const payload = normalizeTenantScopeFixturePayload(input.payload);
    const now = input.now ?? new Date();
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: TENANT_SCOPE_FIXTURE_WRITE_PERMISSION,
      now,
      operation: async ({ database, scope }) => {
        const result = await database.query<TenantScopeFixtureRow>(
          TENANT_SCOPE_FIXTURE_INSERT_SQL,
          [
            createTenantScopeFixtureId(),
            scope.tenantId,
            recordKey,
            JSON.stringify(payload),
            scope.membershipId,
            now.toISOString()
          ]
        );
        const row = result.rows[0];
        if (!row) throw new TenantScopeConflictError();
        return fixtureFromRow(row);
      }
    });
  }

  async update(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
    >,
    input: {
      fixtureId: string;
      expectedVersion: number;
      recordKey: string;
      payload: unknown;
      now?: Date;
    }
  ): Promise<TenantScopeFixtureRecord> {
    const recordKey = normalizeTenantScopeFixtureKey(input.recordKey);
    const payload = normalizeTenantScopeFixturePayload(input.payload);
    const now = input.now ?? new Date();
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: TENANT_SCOPE_FIXTURE_WRITE_PERMISSION,
      now,
      operation: async ({ database, scope }) => {
        const result = await database.query<TenantScopeFixtureRow>(
          TENANT_SCOPE_FIXTURE_UPDATE_SQL,
          [
            scope.tenantId,
            input.fixtureId,
            recordKey,
            JSON.stringify(payload),
            input.expectedVersion,
            now.toISOString()
          ]
        );
        const row = result.rows[0];
        if (!row) throw new TenantScopeConflictError();
        return fixtureFromRow(row);
      }
    });
  }

  async delete(
    principal: TenantPermissionPrincipal<
      typeof TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
    >,
    fixtureId: string,
    now = new Date()
  ): Promise<boolean> {
    return runTenantScopedCommand({
      database: await this.client(),
      principal,
      permission: TENANT_SCOPE_FIXTURE_WRITE_PERMISSION,
      now,
      operation: async ({ database, scope }) => {
        const result = await database.query<{ fixture_id: string }>(
          TENANT_SCOPE_FIXTURE_DELETE_SQL,
          [scope.tenantId, fixtureId]
        );
        return result.rows.length === 1;
      }
    });
  }
}

let repository: TenantScopeFixtureRepository | null = null;

export function getTenantScopeFixtureRepository(): TenantScopeFixtureRepository {
  repository ??= new DatabaseTenantScopeFixtureRepository();
  return repository;
}
