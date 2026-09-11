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
  releaseSha: "m1-04-final-isolation-suite",
  sessionSecret: "m1-04-final-isolation-session-secret-32-characters",
  authPepper: "m1-04-final-isolation-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const WRITE_PERMISSION = "company.settings.manage";

function extractSql(source, name) {
  const prefix = `export const ${name} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${name} must be extractable`);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  assert.notEqual(end, -1, `${name} SQL terminator must be extractable`);
  return source.slice(contentStart, end);
}

async function contracts() {
  const [guardSource, repositorySource] = await Promise.all([
    readFile(
      resolve("src/lib/authorization/tenant-scoped-command-guard.ts"),
      "utf8"
    ),
    readFile(
      resolve("src/lib/authorization/tenant-scope-fixture-repository.ts"),
      "utf8"
    )
  ]);

  return {
    guardSource,
    repositorySource,
    guard: extractSql(guardSource, "TENANT_COMMAND_SCOPE_SQL"),
    find: extractSql(repositorySource, "TENANT_SCOPE_FIXTURE_FIND_SQL"),
    update: extractSql(repositorySource, "TENANT_SCOPE_FIXTURE_UPDATE_SQL"),
    delete: extractSql(repositorySource, "TENANT_SCOPE_FIXTURE_DELETE_SQL")
  };
}

async function authorize(database, guardSql, context, overrides = {}) {
  return database.query(guardSql, [
    overrides.membershipId ?? context.membershipId,
    overrides.tenantId ?? context.tenantId,
    overrides.accountId ?? context.accountId,
    overrides.sessionId ?? context.sessionId,
    overrides.now ?? context.now,
    overrides.permission ?? WRITE_PERMISSION
  ]);
}

async function insertCompanionOwner(database, context, character) {
  const accountId = `account_final_isolation_companion_${character}`;
  const membershipId = opaqueFixtureId("membership", character);
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      accountId,
      `final-isolation-companion-${character.toLowerCase()}@example.com`,
      `Final Isolation Companion ${character}`,
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

async function expectLifecycleRevocation(database, guardSql, character, mutate) {
  const context = await bootstrapCompanyScopeTenant(database, { character });
  assert.equal((await authorize(database, guardSql, context)).rows.length, 1);
  await mutate(context);
  assert.equal(
    (await authorize(database, guardSql, context)).rows.length,
    0,
    `${character} lifecycle mutation must deny the previously valid principal`
  );
}

test("every accepted protected endpoint is bound to one fixed portal role", async () => {
  const endpoints = [
    ["worker", "/worker/dashboard", "src/app/worker/(portal)/layout.tsx"],
    ["worker", "/worker/profile", "src/app/worker/(portal)/layout.tsx"],
    ["worker", "/worker/onboarding", "src/app/worker/(portal)/layout.tsx"],
    ["company", "/company/dashboard", "src/app/company/(portal)/layout.tsx"],
    ["company", "/company/tenant-scope", "src/app/company/(portal)/layout.tsx"],
    ["assessor", "/assessor/dashboard", "src/app/assessor/(portal)/layout.tsx"],
    ["verifier", "/verifier/dashboard", "src/app/verifier/(portal)/layout.tsx"],
    ["admin", "/admin/dashboard", "src/app/admin/(portal)/layout.tsx"],
    ["admin", "/admin/staff", "src/app/admin/(portal)/layout.tsx"],
    ["root", "/root/dashboard", "src/app/root/(portal)/layout.tsx"],
    ["root", "/root/staff", "src/app/root/(portal)/layout.tsx"]
  ];

  const workerSession = await readFile(
    resolve("src/lib/auth/worker-session.ts"),
    "utf8"
  );
  assert.match(workerSession, /requireRoleSession\("worker"\)/);

  for (const [role, endpoint, layoutPath] of endpoints) {
    const layout = await readFile(resolve(layoutPath), "utf8");
    if (role === "worker") {
      assert.match(layout, /requireWorkerSession/);
    } else {
      assert.match(layout, new RegExp(`requireRoleSession\\("${role}"\\)`));
    }
    assert.ok(endpoint.startsWith(`/${role}/`));
  }
});

test("cross-tenant, missing and malformed identifiers are non-enumerating for every accepted record command", async () => {
  const sql = await contracts();
  assert.doesNotMatch(
    sql.repositorySource,
    /SELECT\s+EXISTS/i,
    "the accepted repository must not expose a separate existence oracle"
  );
  assert.match(sql.find, /WHERE tenant_id = \$1 AND fixture_id = \$2/);
  assert.match(sql.update, /WHERE tenant_id = \$1[\s\S]*fixture_id = \$2/);
  assert.match(sql.delete, /WHERE tenant_id = \$1 AND fixture_id = \$2/);

  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const tenantA = await bootstrapCompanyScopeTenant(database, { character: "A" });
    const tenantB = await bootstrapCompanyScopeTenant(database, { character: "B" });
    const fixtureA = await insertCompanyScopeDemonstrationRecord(database, {
      character: "A",
      context: tenantA,
      recordKey: "final-isolation-record",
      title: "Final isolation record"
    });
    const missingId = opaqueFixtureId("tenantfixture", "Z");
    const malformedId = "../../tenantfixture-not-valid";

    const findResults = await Promise.all([
      database.query(sql.find, [tenantB.tenantId, fixtureA]),
      database.query(sql.find, [tenantB.tenantId, missingId]),
      database.query(sql.find, [tenantB.tenantId, malformedId])
    ]);
    assert.deepEqual(findResults.map((result) => result.rows), [[], [], []]);

    const updateResults = await Promise.all([
      database.query(sql.update, [
        tenantB.tenantId,
        fixtureA,
        "forbidden-cross-tenant",
        JSON.stringify({ title: "Forbidden", demonstration: true }),
        1,
        "2026-08-06T03:35:00.000Z"
      ]),
      database.query(sql.update, [
        tenantB.tenantId,
        missingId,
        "missing-record",
        JSON.stringify({ title: "Missing", demonstration: true }),
        1,
        "2026-08-06T03:35:00.000Z"
      ]),
      database.query(sql.update, [
        tenantB.tenantId,
        malformedId,
        "malformed-record",
        JSON.stringify({ title: "Malformed", demonstration: true }),
        1,
        "2026-08-06T03:35:00.000Z"
      ])
    ]);
    assert.deepEqual(updateResults.map((result) => result.rows), [[], [], []]);

    const deleteResults = await Promise.all([
      database.query(sql.delete, [tenantB.tenantId, fixtureA]),
      database.query(sql.delete, [tenantB.tenantId, missingId]),
      database.query(sql.delete, [tenantB.tenantId, malformedId])
    ]);
    assert.deepEqual(deleteResults.map((result) => result.rows), [[], [], []]);

    const stillOwned = await database.query(sql.find, [tenantA.tenantId, fixtureA]);
    assert.equal(stillOwned.rows.length, 1);

    const lockMismatches = await Promise.all([
      authorize(database, sql.guard, tenantA, { tenantId: tenantB.tenantId }),
      authorize(database, sql.guard, tenantA, { accountId: tenantB.accountId }),
      authorize(database, sql.guard, tenantA, { sessionId: tenantB.sessionId }),
      authorize(database, sql.guard, tenantA, { membershipId: tenantB.membershipId })
    ]);
    assert.deepEqual(lockMismatches.map((result) => result.rows), [[], [], [], []]);
  } finally {
    await database.close();
  }
});

test("transactional authorization revalidation denies every accepted lifecycle and permission race", async () => {
  const sql = await contracts();
  assert.match(sql.guard, /FOR UPDATE OF memberships, tenants, accounts, sessions/);
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);

    await expectLifecycleRevocation(database, sql.guard, "C", async (context) => {
      await database.query(
        `UPDATE auth_sessions
         SET revoked_at = $2, revocation_reason = 'final_suite'
         WHERE session_id = $1`,
        [context.sessionId, "2026-08-06T03:36:00.000Z"]
      );
    });

    await expectLifecycleRevocation(database, sql.guard, "D", async (context) => {
      await database.query(
        `UPDATE auth_accounts
         SET account_status = 'disabled', updated_at = $2
         WHERE account_id = $1`,
        [context.accountId, "2026-08-06T03:37:00.000Z"]
      );
    });

    await expectLifecycleRevocation(database, sql.guard, "E", async (context) => {
      await database.query(
        `UPDATE platform_tenants
         SET tenant_status = 'suspended', suspended_at = $2, updated_at = $2
         WHERE tenant_id = $1`,
        [context.tenantId, "2026-08-06T03:38:00.000Z"]
      );
    });

    await expectLifecycleRevocation(database, sql.guard, "F", async (context) => {
      await insertCompanionOwner(database, context, "J");
      await database.query(
        `UPDATE auth_tenant_memberships
         SET membership_status = 'suspended', suspended_at = $2, updated_at = $2
         WHERE membership_id = $1`,
        [context.membershipId, "2026-08-06T03:39:00.000Z"]
      );
    });

    await expectLifecycleRevocation(database, sql.guard, "G", async (context) => {
      await database.query(
        `INSERT INTO auth_account_roles (account_id, role, created_at)
         VALUES ($1, 'worker', $2)`,
        [context.accountId, "2026-08-06T03:40:00.000Z"]
      );
      await database.query(
        `UPDATE auth_sessions SET active_role = 'worker' WHERE session_id = $1`,
        [context.sessionId]
      );
    });

    await expectLifecycleRevocation(database, sql.guard, "H", async (context) => {
      await insertCompanionOwner(database, context, "K");
      await database.query(
        `UPDATE auth_tenant_memberships
         SET membership_role = 'viewer', updated_at = $2
         WHERE membership_id = $1`,
        [context.membershipId, "2026-08-06T03:41:00.000Z"]
      );
    });

    await expectLifecycleRevocation(database, sql.guard, "I", async (context) => {
      await database.query(
        `INSERT INTO auth_tenant_permission_overrides (
           membership_id, membership_role, permission_key, effect,
           created_by_account_id, reason, created_at
         ) VALUES ($1, 'owner', $2, 'deny', $3, $4, $5)`,
        [
          context.membershipId,
          WRITE_PERMISSION,
          context.accountId,
          "Final isolation race denial",
          "2026-08-06T03:42:00.000Z"
        ]
      );
    });
  } finally {
    await database.close();
  }
});