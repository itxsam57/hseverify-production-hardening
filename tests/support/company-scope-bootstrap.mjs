const DEFAULT_NOW = "2026-08-05T17:00:00.000Z";
const DEFAULT_EXPIRES = "2099-01-01T00:00:00.000Z";

export function opaqueFixtureId(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

export async function bootstrapCompanyScopeTenant(database, input) {
  const character = input.character;
  const now = input.now ?? DEFAULT_NOW;
  const expiresAt = input.expiresAt ?? DEFAULT_EXPIRES;
  const accountId = `account_company_scope_${character}`;
  const tenantId = opaqueFixtureId("tenant", character);
  const membershipId = opaqueFixtureId("membership", character);
  const sessionId = `session_company_scope_${character}`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `company-scope-${character.toLowerCase()}@example.com`,
      `Company Scope ${character}`,
      "scrypt$16384$8$1$salt$hash",
      now
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, now]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `Synthetic Company ${character}`, accountId, now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, now]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [
      sessionId,
      accountId,
      `company-scope-token-${character}`,
      `company-scope-csrf-${character}`,
      now,
      expiresAt
    ]
  );

  return Object.freeze({
    accountId,
    tenantId,
    membershipId,
    sessionId,
    now
  });
}

export async function insertCompanyScopeDemonstrationRecord(database, input) {
  const fixtureId =
    input.fixtureId ?? opaqueFixtureId("tenantfixture", input.character);
  const now = input.now ?? DEFAULT_NOW;
  await database.query(
    `INSERT INTO authorization_tenant_scope_fixtures (
       fixture_id, tenant_id, record_key, payload, version,
       created_by_membership_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4::jsonb, 1, $5, $6, $6)`,
    [
      fixtureId,
      input.context.tenantId,
      input.recordKey,
      JSON.stringify({
        title: input.title,
        note: input.note ?? "",
        demonstration: true
      }),
      input.context.membershipId,
      now
    ]
  );
  return fixtureId;
}
