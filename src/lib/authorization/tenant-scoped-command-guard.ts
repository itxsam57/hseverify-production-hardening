import "server-only";

import type { DatabaseClient } from "../database/database";
import type { TenantPermission } from "./authorization-domain";
import {
  TenantScopeDeniedError,
  deriveTrustedTenantScope,
  type TenantPermissionPrincipal,
  type TrustedTenantScope
} from "./tenant-scoped-resource-domain";

export const TENANT_COMMAND_SCOPE_SQL = `
SELECT
  memberships.tenant_id,
  memberships.membership_id,
  memberships.membership_role
FROM auth_tenant_memberships AS memberships
JOIN platform_tenants AS tenants
  ON tenants.tenant_id = memberships.tenant_id
JOIN auth_accounts AS accounts
  ON accounts.account_id = memberships.account_id
JOIN auth_account_roles AS account_roles
  ON account_roles.account_id = memberships.account_id
 AND account_roles.role = 'company'
JOIN auth_sessions AS sessions
  ON sessions.session_id = $4
 AND sessions.account_id = memberships.account_id
 AND sessions.active_role = 'company'
JOIN auth_tenant_role_permission_ceiling AS ceiling
  ON ceiling.membership_role = memberships.membership_role
 AND ceiling.permission_key = $6
LEFT JOIN auth_tenant_permission_overrides AS denied_override
  ON denied_override.membership_id = memberships.membership_id
 AND denied_override.membership_role = memberships.membership_role
 AND denied_override.permission_key = $6
 AND denied_override.effect = 'deny'
WHERE memberships.membership_id = $1
  AND memberships.tenant_id = $2
  AND memberships.account_id = $3
  AND memberships.membership_status = 'active'
  AND tenants.tenant_status = 'active'
  AND accounts.account_status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > $5::timestamptz
  AND denied_override.membership_id IS NULL
FOR UPDATE OF memberships, tenants, accounts, sessions`;

type TenantCommandScopeRow = {
  tenant_id: string;
  membership_id: string;
  membership_role: string;
};

export async function runTenantScopedCommand<
  P extends TenantPermission,
  Result
>(input: {
  database: DatabaseClient;
  principal: TenantPermissionPrincipal<P>;
  permission: P;
  now?: Date;
  operation: (input: {
    database: DatabaseClient;
    scope: TrustedTenantScope;
  }) => Promise<Result>;
}): Promise<Result> {
  if (input.principal.authorizedTenantPermission !== input.permission) {
    throw new TenantScopeDeniedError();
  }

  const scope = deriveTrustedTenantScope(input.principal);
  const now = input.now ?? new Date();

  return input.database.transaction(async (database) => {
    const locked = await database.query<TenantCommandScopeRow>(
      TENANT_COMMAND_SCOPE_SQL,
      [
        scope.membershipId,
        scope.tenantId,
        scope.accountId,
        scope.sessionId,
        now.toISOString(),
        input.permission
      ]
    );
    const row = locked.rows[0];
    if (
      !row ||
      row.tenant_id !== scope.tenantId ||
      row.membership_id !== scope.membershipId
    ) {
      throw new TenantScopeDeniedError();
    }

    return input.operation({ database, scope });
  });
}
