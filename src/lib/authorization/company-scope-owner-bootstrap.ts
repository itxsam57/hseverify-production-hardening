import "server-only";

import { hashOpaqueValue } from "@/lib/auth/auth-domain";
import {
  requireRoleSession,
  type AuthenticatedSession
} from "@/lib/auth/auth-session-service";
import type { RuntimeEnvironment } from "@/lib/config/environment";
import { getServerEnvironment } from "@/lib/config/server-environment";
import {
  getDatabaseClient,
  type DatabaseClient
} from "@/lib/database/database";

type CurrentCompanyMembershipRow = {
  membership_id: string;
  tenant_id: string;
  membership_role: string;
  membership_status: string;
  tenant_status: string;
};

export type CompanyScopeOwnerBootstrapResult = Readonly<{
  enabled: boolean;
  created: boolean;
}>;

export const CURRENT_COMPANY_MEMBERSHIP_SQL = `
  SELECT
    memberships.membership_id,
    memberships.tenant_id,
    memberships.membership_role,
    memberships.membership_status,
    tenants.tenant_status
  FROM auth_tenant_memberships AS memberships
  INNER JOIN platform_tenants AS tenants
    ON tenants.tenant_id = memberships.tenant_id
  WHERE memberships.account_id = $1
    AND memberships.portal_role = 'company'
    AND memberships.membership_status IN ('invited', 'active', 'suspended')
  ORDER BY memberships.created_at ASC
`;

export const INSERT_SYNTHETIC_COMPANY_TENANT_SQL = `
  INSERT INTO platform_tenants (
    tenant_id,
    tenant_type,
    display_name,
    tenant_status,
    created_by_account_id,
    created_at,
    updated_at,
    activated_at
  ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)
  ON CONFLICT (tenant_id) DO NOTHING
`;

export const INSERT_SYNTHETIC_COMPANY_MEMBERSHIP_SQL = `
  INSERT INTO auth_tenant_memberships (
    membership_id,
    tenant_id,
    account_id,
    portal_role,
    membership_role,
    membership_status,
    created_by_account_id,
    created_at,
    updated_at,
    activated_at
  ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)
  ON CONFLICT (membership_id) DO NOTHING
`;

export const VERIFY_SYNTHETIC_COMPANY_MEMBERSHIP_SQL = `
  SELECT
    memberships.membership_id,
    memberships.tenant_id,
    memberships.membership_role,
    memberships.membership_status,
    tenants.tenant_status
  FROM auth_tenant_memberships AS memberships
  INNER JOIN platform_tenants AS tenants
    ON tenants.tenant_id = memberships.tenant_id
  WHERE memberships.membership_id = $1
    AND memberships.tenant_id = $2
    AND memberships.account_id = $3
    AND memberships.portal_role = 'company'
`;

export function isLocalCompanyScopeBootstrapEnvironment(
  environment: RuntimeEnvironment
): boolean {
  return (
    (environment.appEnvironment === "development" ||
      environment.appEnvironment === "test") &&
    environment.databaseDriver === "pglite"
  );
}

function deterministicIdentifier(input: {
  prefix: "tenant" | "membership";
  accountId: string;
  pepper: string;
}): string {
  const suffix = hashOpaqueValue(
    input.accountId,
    input.pepper,
    `m1-04-company-scope-${input.prefix}`
  ).slice(0, 24);
  return `${input.prefix}_${suffix}`;
}

async function readCurrentMembership(
  database: DatabaseClient,
  accountId: string
): Promise<CurrentCompanyMembershipRow | null> {
  const result = await database.query<CurrentCompanyMembershipRow>(
    CURRENT_COMPANY_MEMBERSHIP_SQL,
    [accountId]
  );
  if (result.rows.length > 1) {
    throw new Error(
      "The local Company account resolved more than one current tenant membership."
    );
  }
  return result.rows[0] ?? null;
}

function assertUsableExistingMembership(
  membership: CurrentCompanyMembershipRow
): void {
  if (
    membership.membership_status !== "active" ||
    membership.tenant_status !== "active"
  ) {
    throw new Error(
      "The local Company account already has a non-active tenant context. It was not modified by the demonstration bootstrap."
    );
  }
}

// Owner-test repair boundary:
// Subunit 4 originally created deterministic Company tenant fixtures only in
// tests/support. This runtime adapter fills that missing local-only boundary for
// an already authenticated Company account. It never accepts browser identity,
// tenant, membership, role, permission or scope input, and it is disabled for
// preview, production and every PostgreSQL environment.
export async function ensureLocalCompanyScopeOwnerBootstrap(input?: {
  database?: DatabaseClient;
  environment?: RuntimeEnvironment;
  session?: AuthenticatedSession;
  now?: Date;
}): Promise<CompanyScopeOwnerBootstrapResult> {
  const environment = input?.environment ?? getServerEnvironment();
  if (!isLocalCompanyScopeBootstrapEnvironment(environment)) {
    return Object.freeze({ enabled: false, created: false });
  }

  const session = input?.session ?? (await requireRoleSession("company"));
  if (session.role !== "company") {
    throw new Error("Company scope bootstrap requires a Company session.");
  }

  const database = input?.database ?? (await getDatabaseClient());
  const now = (input?.now ?? new Date()).toISOString();

  return database.transaction(async (transaction) => {
    const existing = await readCurrentMembership(transaction, session.accountId);
    if (existing) {
      assertUsableExistingMembership(existing);
      return Object.freeze({ enabled: true, created: false });
    }

    const tenantId = deterministicIdentifier({
      prefix: "tenant",
      accountId: session.accountId,
      pepper: environment.authPepper
    });
    const membershipId = deterministicIdentifier({
      prefix: "membership",
      accountId: session.accountId,
      pepper: environment.authPepper
    });

    await transaction.query(INSERT_SYNTHETIC_COMPANY_TENANT_SQL, [
      tenantId,
      `${session.displayName} synthetic tenant`,
      session.accountId,
      now
    ]);
    await transaction.query(INSERT_SYNTHETIC_COMPANY_MEMBERSHIP_SQL, [
      membershipId,
      tenantId,
      session.accountId,
      now
    ]);

    const verified = await transaction.query<CurrentCompanyMembershipRow>(
      VERIFY_SYNTHETIC_COMPANY_MEMBERSHIP_SQL,
      [membershipId, tenantId, session.accountId]
    );
    const verifiedMembership = verified.rows[0];
    if (!verifiedMembership || verified.rows.length !== 1) {
      throw new Error(
        "The local synthetic Company tenant membership could not be verified."
      );
    }
    assertUsableExistingMembership(verifiedMembership);

    return Object.freeze({ enabled: true, created: true });
  });
}
