import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "root-bootstrap-service-principal-test",
  sessionSecret: "root-bootstrap-service-principal-session-secret-2026-64chars",
  authPepper: "root-bootstrap-service-principal-auth-pepper-2026-64chars",
  authSandboxEnabled: true,
  authSandboxAccessKey: "root-bootstrap-service-principal-sandbox-key",
  demoAuthEnabled: false,
  demoDataEnabled: false
};

test("public concern service principal remains disabled without consuming the human Root portal role", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);

    const account = await database.query(
      `SELECT account_status, password_hash
       FROM auth_accounts
       WHERE account_id = 'account_public_concern_intake_system'`
    );
    assert.equal(account.rows.length, 1);
    assert.equal(account.rows[0].account_status, "disabled");
    assert.equal(account.rows[0].password_hash, null);

    const portalRoles = await database.query(
      `SELECT role
       FROM auth_account_roles
       WHERE account_id = 'account_public_concern_intake_system'`
    );
    assert.deepEqual(portalRoles.rows, []);

    const humanRootAssignments = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM auth_account_roles AS roles
       JOIN auth_accounts AS accounts ON accounts.account_id = roles.account_id
       WHERE roles.role = 'root' AND accounts.account_status = 'active'`
    );
    assert.equal(humanRootAssignments.rows[0]?.count, 0);
  } finally {
    await database.close();
  }
});
