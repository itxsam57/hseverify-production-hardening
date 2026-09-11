import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";
import {
  bootstrapCompanyScopeTenant,
  insertCompanyScopeDemonstrationRecord,
  opaqueFixtureId
} from "../support/company-scope-bootstrap.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "company-scope-demonstration-test",
  sessionSecret: "company-scope-demo-session-secret-32-characters",
  authPepper: "company-scope-demo-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function extractSql(source, name) {
  const prefix = `export const ${name} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${name} must be extractable`);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  assert.notEqual(end, -1, `${name} SQL terminator must be extractable`);
  return source.slice(contentStart, end);
}

async function sqlContracts() {
  const repository = await readFile(
    resolve("src/lib/authorization/tenant-scope-fixture-repository.ts"),
    "utf8"
  );
  const guard = await readFile(
    resolve("src/lib/authorization/tenant-scoped-command-guard.ts"),
    "utf8"
  );
  return {
    guard: extractSql(guard, "TENANT_COMMAND_SCOPE_SQL"),
    list: extractSql(repository, "TENANT_SCOPE_FIXTURE_LIST_SQL"),
    find: extractSql(repository, "TENANT_SCOPE_FIXTURE_FIND_SQL"),
    update: extractSql(repository, "TENANT_SCOPE_FIXTURE_UPDATE_SQL"),
    delete: extractSql(repository, "TENANT_SCOPE_FIXTURE_DELETE_SQL")
  };
}

async function ownerBootstrapSqlContracts() {
  const source = await readFile(
    resolve("src/lib/authorization/company-scope-owner-bootstrap.ts"),
    "utf8"
  );
  return {
    current: extractSql(source, "CURRENT_COMPANY_MEMBERSHIP_SQL"),
    insertTenant: extractSql(source, "INSERT_SYNTHETIC_COMPANY_TENANT_SQL"),
    insertMembership: extractSql(
      source,
      "INSERT_SYNTHETIC_COMPANY_MEMBERSHIP_SQL"
    ),
    verify: extractSql(source, "VERIFY_SYNTHETIC_COMPANY_MEMBERSHIP_SQL")
  };
}

async function authorize(database, sql, context, permission) {
  return database.query(sql, [
    context.membershipId,
    context.tenantId,
    context.accountId,
    context.sessionId,
    context.now,
    permission
  ]);
}

async function insertCompanionOwner(database, context, character) {
  const accountId = `account_company_scope_companion_${character}`;
  const membershipId = opaqueFixtureId("membership", character);
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `company-scope-companion-${character.toLowerCase()}@example.com`,
      `Company Scope Companion ${character}`,
      "scrypt$16384$8$1$salt$hash",
      context.now
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, context.now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
    [membershipId, context.tenantId, accountId, context.accountId, context.now]
  );
}

test("Company demonstration page and actions accept no tenant selector", async () => {
  const [page, actions, component, service, bootstrap, loading, error] =
    await Promise.all([
      readFile(resolve("src/app/company/(portal)/tenant-scope/page.tsx"), "utf8"),
      readFile(resolve("src/app/company/(portal)/tenant-scope/actions.ts"), "utf8"),
      readFile(resolve("src/components/company/tenant-scope-demonstration.tsx"), "utf8"),
      readFile(resolve("src/lib/authorization/tenant-scope-fixture-service.ts"), "utf8"),
      readFile(resolve("src/lib/authorization/company-scope-owner-bootstrap.ts"), "utf8"),
      readFile(resolve("src/app/company/(portal)/tenant-scope/loading.tsx"), "utf8"),
      readFile(resolve("src/app/company/(portal)/tenant-scope/error.tsx"), "utf8")
    ]);

  assert.match(page, /ensureLocalCompanyScopeOwnerBootstrap\(\)/);
  assert.match(page, /loadCompanyScopeDemonstration\(\)/);
  assert.ok(
    page.indexOf("ensureLocalCompanyScopeOwnerBootstrap()") <
      page.indexOf("loadCompanyScopeDemonstration()")
  );
  assert.match(page, /TenantScopeDemonstration/);
  assert.match(actions, /createTenantScopeFixture/);
  assert.match(actions, /updateTenantScopeFixture/);
  assert.match(actions, /deleteTenantScopeFixture/);
  assert.match(service, /requireCurrentTenantPermission/);
  assert.match(service, /TENANT_SCOPE_FIXTURE_READ_PERMISSION/);
  assert.match(bootstrap, /requireRoleSession\("company"\)/);
  assert.match(bootstrap, /appEnvironment === "development"/);
  assert.match(bootstrap, /appEnvironment === "test"/);
  assert.match(bootstrap, /databaseDriver === "pglite"/);
  assert.match(component, /Create demonstration record/);
  assert.match(component, /ConfirmDialog/);
  assert.match(loading, /LoadingState/);
  assert.match(error, /No tenant or record details were exposed/);

  for (const forbidden of [
    "tenantId",
    "membershipId",
    "activeRole",
    "permission",
    "authorizedTenantPermission"
  ]) {
    assert.doesNotMatch(
      actions,
      new RegExp(`formData\\.get\\([\"']${forbidden}[\"']\\)`),
      `${forbidden} must not be accepted from FormData`
    );
    assert.doesNotMatch(
      component,
      new RegExp(`name=[\"']${forbidden}[\"']`),
      `${forbidden} must not be emitted by the browser form`
    );
  }

  assert.match(component, /name="fixtureId"/);
  assert.match(component, /name="expectedVersion"/);
  assert.match(component, /name="recordKey"/);
  assert.match(component, /router\.refresh\(\)/);
});

test("local owner bootstrap attaches one deterministic active tenant context to an existing Company account", async () => {
  const sql = await ownerBootstrapSqlContracts();
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const accountId = "account_company_owner_browser_test";
    const tenantId = opaqueFixtureId("tenant", "Q");
    const membershipId = opaqueFixtureId("membership", "Q");
    const now = "2026-08-05T18:45:00.000Z";

    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         password_hash, email_verified_at, password_set_at,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
      [
        accountId,
        "owner-browser@example.com",
        "Owner Browser Company",
        "scrypt$16384$8$1$salt$hash",
        now
      ]
    );
    await database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'company', $2)`,
      [accountId, now]
    );

    assert.deepEqual((await database.query(sql.current, [accountId])).rows, []);

    await database.query(sql.insertTenant, [
      tenantId,
      "Owner Browser Company synthetic tenant",
      accountId,
      now
    ]);
    await database.query(sql.insertMembership, [
      membershipId,
      tenantId,
      accountId,
      now
    ]);

    const verified = await database.query(sql.verify, [
      membershipId,
      tenantId,
      accountId
    ]);
    assert.equal(verified.rows.length, 1);
    assert.equal(verified.rows[0].membership_status, "active");
    assert.equal(verified.rows[0].membership_role, "owner");
    assert.equal(verified.rows[0].tenant_status, "active");

    await database.query(sql.insertTenant, [
      tenantId,
      "Owner Browser Company synthetic tenant",
      accountId,
      now
    ]);
    await database.query(sql.insertMembership, [
      membershipId,
      tenantId,
      accountId,
      now
    ]);

    const current = await database.query(sql.current, [accountId]);
    assert.equal(current.rows.length, 1);
    assert.equal(current.rows[0].membership_id, membershipId);
    assert.equal(current.rows[0].tenant_id, tenantId);
  } finally {
    await database.close();
  }
});

test("two bootstrapped Company tenants see only their own demonstration records", async () => {
  const sql = await sqlContracts();
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const tenantA = await bootstrapCompanyScopeTenant(database, {
      character: "M"
    });
    const tenantB = await bootstrapCompanyScopeTenant(database, {
      character: "N"
    });

    assert.equal(
      (await authorize(database, sql.guard, tenantA, "company.tenant.read"))
        .rows.length,
      1
    );
    assert.equal(
      (await authorize(database, sql.guard, tenantB, "company.tenant.read"))
        .rows.length,
      1
    );

    const fixtureA = await insertCompanyScopeDemonstrationRecord(database, {
      character: "M",
      context: tenantA,
      recordKey: "shared-demo-key",
      title: "Tenant A demonstration"
    });
    const fixtureB = await insertCompanyScopeDemonstrationRecord(database, {
      character: "N",
      context: tenantB,
      recordKey: "shared-demo-key",
      title: "Tenant B demonstration"
    });

    const listA = await database.query(sql.list, [tenantA.tenantId]);
    const listB = await database.query(sql.list, [tenantB.tenantId]);
    assert.deepEqual(listA.rows.map((row) => row.fixture_id), [fixtureA]);
    assert.deepEqual(listB.rows.map((row) => row.fixture_id), [fixtureB]);

    const ownA = await database.query(sql.find, [tenantA.tenantId, fixtureA]);
    const crossAFromB = await database.query(sql.find, [
      tenantB.tenantId,
      fixtureA
    ]);
    const missingFromB = await database.query(sql.find, [
      tenantB.tenantId,
      opaqueFixtureId("tenantfixture", "Z")
    ]);
    assert.equal(ownA.rows.length, 1);
    assert.deepEqual(crossAFromB.rows, missingFromB.rows);

    const crossUpdate = await database.query(sql.update, [
      tenantB.tenantId,
      fixtureA,
      "changed-demo-key",
      JSON.stringify({ title: "Forbidden", demonstration: true }),
      1,
      "2026-08-05T17:01:00.000Z"
    ]);
    const crossDelete = await database.query(sql.delete, [
      tenantB.tenantId,
      fixtureA
    ]);
    assert.equal(crossUpdate.rows.length, 0);
    assert.equal(crossDelete.rows.length, 0);

    const stillOwnedByA = await database.query(sql.find, [
      tenantA.tenantId,
      fixtureA
    ]);
    assert.equal(stillOwnedByA.rows.length, 1);
  } finally {
    await database.close();
  }
});

test("stale Company membership cannot use the demonstration command boundary", async () => {
  const sql = await sqlContracts();
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const context = await bootstrapCompanyScopeTenant(database, {
      character: "P"
    });
    await insertCompanionOwner(database, context, "R");

    assert.equal(
      (await authorize(database, sql.guard, context, "company.settings.manage"))
        .rows.length,
      1
    );

    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'revoked', revoked_at = $2, updated_at = $2
       WHERE membership_id = $1`,
      [context.membershipId, "2026-08-05T17:02:00.000Z"]
    );

    assert.equal(
      (await authorize(database, sql.guard, context, "company.settings.manage"))
        .rows.length,
      0
    );
  } finally {
    await database.close();
  }
});