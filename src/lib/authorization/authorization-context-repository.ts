import "server-only";

import type { AccountStatus, AuthRole } from "@/lib/auth/auth-domain";
import {
  isTenantMembershipRole,
  isTenantMembershipStatus,
  isTenantPermission,
  isTenantStatus,
  type PermissionOverrideEffect,
  type TenantPermissionOverride
} from "@/lib/authorization/authorization-domain";
import type { TrustedSessionAuthorizationSnapshot } from "@/lib/authorization/authorization-context-domain";
import {
  getDatabaseClient,
  type DatabaseClient
} from "@/lib/database/database";

type DatabaseTimestamp = string | Date;

type AuthorizationContextRow = {
  session_id: string;
  session_account_id: string;
  active_role: AuthRole;
  session_created_at: DatabaseTimestamp;
  session_last_seen_at: DatabaseTimestamp;
  session_expires_at: DatabaseTimestamp;
  session_revoked_at: DatabaseTimestamp | null;
  account_id: string;
  email_normalized: string;
  display_name: string;
  account_status: AccountStatus;
  role_assigned: boolean;
  membership_id: string | null;
  tenant_id: string | null;
  tenant_status: string | null;
  membership_role: string | null;
  membership_status: string | null;
  permission_overrides: unknown;
};

type RawPermissionOverride = {
  permission: unknown;
  effect: unknown;
};

// BUILD-PIN AUTHZ-SESSION-CONTEXT-QUERY:
// This query is the only session-to-tenant context loader. It intentionally
// returns expired, revoked and inactive state so the central domain resolver can
// classify denial without trusting route or browser input. Never add a tenant
// selector parameter to this query.
export const AUTHORIZATION_CONTEXT_SQL = `
  SELECT
    sessions.session_id,
    sessions.account_id AS session_account_id,
    sessions.active_role,
    sessions.created_at AS session_created_at,
    sessions.last_seen_at AS session_last_seen_at,
    sessions.expires_at AS session_expires_at,
    sessions.revoked_at AS session_revoked_at,
    accounts.account_id,
    accounts.email_normalized,
    accounts.display_name,
    accounts.account_status,
    (assigned_roles.account_id IS NOT NULL) AS role_assigned,
    memberships.membership_id,
    memberships.tenant_id,
    tenants.tenant_status,
    memberships.membership_role,
    memberships.membership_status,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'permission', overrides.permission_key,
            'effect', overrides.effect
          )
          ORDER BY overrides.permission_key
        )
        FROM auth_tenant_permission_overrides AS overrides
        WHERE overrides.membership_id = memberships.membership_id
      ),
      '[]'::jsonb
    ) AS permission_overrides
  FROM auth_sessions AS sessions
  INNER JOIN auth_accounts AS accounts
    ON accounts.account_id = sessions.account_id
  LEFT JOIN auth_account_roles AS assigned_roles
    ON assigned_roles.account_id = sessions.account_id
   AND assigned_roles.role = sessions.active_role
  LEFT JOIN auth_tenant_memberships AS memberships
    ON sessions.active_role = 'company'
   AND memberships.account_id = sessions.account_id
   AND memberships.portal_role = 'company'
   AND memberships.membership_status IN ('invited', 'active', 'suspended')
  LEFT JOIN platform_tenants AS tenants
    ON tenants.tenant_id = memberships.tenant_id
  WHERE sessions.token_hash = $1
`;

function timestamp(value: DatabaseTimestamp): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableTimestamp(value: DatabaseTimestamp | null): string | null {
  return value === null ? null : timestamp(value);
}

function parsedOverrides(value: unknown): readonly TenantPermissionOverride[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) {
    throw new Error("Authorization permission overrides are not an array.");
  }

  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Authorization permission override is malformed.");
    }
    const raw = entry as RawPermissionOverride;
    if (!isTenantPermission(raw.permission)) {
      throw new Error("Authorization permission override is unknown.");
    }
    if (raw.effect !== "grant" && raw.effect !== "deny") {
      throw new Error("Authorization permission override effect is unknown.");
    }
    return {
      permission: raw.permission,
      effect: raw.effect as PermissionOverrideEffect
    };
  });
}

function snapshotFromRow(
  row: AuthorizationContextRow
): TrustedSessionAuthorizationSnapshot {
  if (row.session_account_id !== row.account_id) {
    throw new Error("Authorization session/account identity is inconsistent.");
  }

  const hasMembership = row.membership_id !== null;
  const membershipValues = [
    row.tenant_id,
    row.tenant_status,
    row.membership_role,
    row.membership_status
  ];
  if (hasMembership !== membershipValues.every((value) => value !== null)) {
    throw new Error("Authorization tenant membership context is incomplete.");
  }

  let tenantMembership: TrustedSessionAuthorizationSnapshot["tenantMembership"] = null;
  if (hasMembership) {
    if (
      !isTenantStatus(row.tenant_status) ||
      !isTenantMembershipRole(row.membership_role) ||
      !isTenantMembershipStatus(row.membership_status) ||
      row.tenant_id === null ||
      row.membership_id === null
    ) {
      throw new Error("Authorization tenant membership context is invalid.");
    }
    tenantMembership = {
      tenantId: row.tenant_id,
      tenantStatus: row.tenant_status,
      membershipId: row.membership_id,
      role: row.membership_role,
      status: row.membership_status,
      overrides: parsedOverrides(row.permission_overrides)
    };
  }

  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    activeRole: row.active_role,
    accountStatus: row.account_status,
    email: row.email_normalized,
    displayName: row.display_name,
    roleAssigned: row.role_assigned,
    createdAt: timestamp(row.session_created_at),
    lastSeenAt: timestamp(row.session_last_seen_at),
    expiresAt: timestamp(row.session_expires_at),
    revokedAt: nullableTimestamp(row.session_revoked_at),
    tenantMembership
  };
}

export class AuthorizationContextRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findBySessionTokenHash(
    tokenHash: string
  ): Promise<TrustedSessionAuthorizationSnapshot | null> {
    const result = await this.database.query<AuthorizationContextRow>(
      AUTHORIZATION_CONTEXT_SQL,
      [tokenHash]
    );
    if (result.rows.length > 1) {
      throw new Error("Authorization session token resolved more than once.");
    }
    return result.rows[0] ? snapshotFromRow(result.rows[0]) : null;
  }

  async touchSession(input: {
    sessionId: string;
    touchedAt: string;
  }): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE auth_sessions
       SET last_seen_at = $2
       WHERE session_id = $1
         AND revoked_at IS NULL
         AND expires_at > $2
         AND last_seen_at < $2`,
      [input.sessionId, input.touchedAt]
    );
    return result.affectedRows === 1;
  }
}

export async function getAuthorizationContextRepository(): Promise<AuthorizationContextRepository> {
  return new AuthorizationContextRepository(await getDatabaseClient());
}
