import "server-only";

import {
  safeTenantReference,
  toCompanyScopeDemoViewRecord,
  type CompanyScopeDemoViewRecord
} from "./company-scope-demonstration-domain";
import { requireCurrentTenantPermission } from "./authorization-service";
import {
  getTenantScopeFixtureRepository,
  type TenantScopeFixtureRepository
} from "./tenant-scope-fixture-repository";
import {
  TENANT_SCOPE_FIXTURE_READ_PERMISSION,
  TENANT_SCOPE_FIXTURE_WRITE_PERMISSION,
  type TenantScopeFixtureRecord
} from "./tenant-scoped-resource-domain";

export type CompanyScopeDemonstrationWorkspace = Readonly<{
  tenantReference: string;
  membershipRole: string;
  records: readonly CompanyScopeDemoViewRecord[];
}>;

// BUILD-PIN AUTHZ-TENANT-SCOPED-SERVICE:
// Request handlers may supply only resource identifiers and resource content.
// Tenant, membership, role and permission context is resolved by the central
// server authorization service and cannot be selected by the caller.
export async function listTenantScopeFixtures(input?: {
  repository?: TenantScopeFixtureRepository;
}): Promise<readonly TenantScopeFixtureRecord[]> {
  const principal = await requireCurrentTenantPermission(
    TENANT_SCOPE_FIXTURE_READ_PERMISSION
  );
  return (input?.repository ?? getTenantScopeFixtureRepository()).list(principal);
}

export async function loadCompanyScopeDemonstration(input?: {
  repository?: TenantScopeFixtureRepository;
}): Promise<CompanyScopeDemonstrationWorkspace> {
  const principal = await requireCurrentTenantPermission(
    TENANT_SCOPE_FIXTURE_READ_PERMISSION
  );
  const records = await (
    input?.repository ?? getTenantScopeFixtureRepository()
  ).list(principal);

  return Object.freeze({
    tenantReference: safeTenantReference(principal.tenantMembership.tenantId),
    membershipRole: principal.tenantMembership.role,
    records: Object.freeze(records.map(toCompanyScopeDemoViewRecord))
  });
}

export async function findTenantScopeFixture(input: {
  fixtureId: string;
  repository?: TenantScopeFixtureRepository;
}): Promise<TenantScopeFixtureRecord | null> {
  const principal = await requireCurrentTenantPermission(
    TENANT_SCOPE_FIXTURE_READ_PERMISSION
  );
  return (input.repository ?? getTenantScopeFixtureRepository()).findById(
    principal,
    input.fixtureId
  );
}

export async function createTenantScopeFixture(input: {
  recordKey: string;
  payload: unknown;
  repository?: TenantScopeFixtureRepository;
}): Promise<TenantScopeFixtureRecord> {
  const principal = await requireCurrentTenantPermission(
    TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
  );
  return (input.repository ?? getTenantScopeFixtureRepository()).create(
    principal,
    {
      recordKey: input.recordKey,
      payload: input.payload
    }
  );
}

export async function updateTenantScopeFixture(input: {
  fixtureId: string;
  expectedVersion: number;
  recordKey: string;
  payload: unknown;
  repository?: TenantScopeFixtureRepository;
}): Promise<TenantScopeFixtureRecord> {
  const principal = await requireCurrentTenantPermission(
    TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
  );
  return (input.repository ?? getTenantScopeFixtureRepository()).update(
    principal,
    {
      fixtureId: input.fixtureId,
      expectedVersion: input.expectedVersion,
      recordKey: input.recordKey,
      payload: input.payload
    }
  );
}

export async function deleteTenantScopeFixture(input: {
  fixtureId: string;
  repository?: TenantScopeFixtureRepository;
}): Promise<boolean> {
  const principal = await requireCurrentTenantPermission(
    TENANT_SCOPE_FIXTURE_WRITE_PERMISSION
  );
  return (input.repository ?? getTenantScopeFixtureRepository()).delete(
    principal,
    input.fixtureId
  );
}
