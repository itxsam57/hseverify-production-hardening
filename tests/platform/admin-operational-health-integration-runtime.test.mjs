import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";
import { getOperationalHealthSnapshot } from "../../src/lib/admin/operational-health-service.ts";

const environment = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m3-08-operational-health-integration",
  sessionSecret: "m3-08-test-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m3-08-test-session-secret-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

test("M3.08 operational health reads durable platform state from PGlite", async () => {
  const database = await openScriptDatabase(environment);
  try {
    await applyPendingMigrations(database, environment.releaseSha);
    await database.query(
      "INSERT INTO auth_accounts (account_id, email_normalized, display_name, account_status, email_verified_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)",
      ["m308_account", "admin@m308.test", "M3.08 Admin", "active"]
    );

    const snapshot = await getOperationalHealthSnapshot(database);

    assert.ok(snapshot.users >= 1);
    assert.equal(snapshot.companies, 0);
    assert.equal(snapshot.cases, 0);
    assert.equal(snapshot.rules, 0);
    assert.equal(snapshot.calibrations, 0);
    assert.equal(snapshot.integrations, 0);
    assert.ok(snapshot.auditEvents >= 0);
    assert.equal(snapshot.status, "healthy");
  } finally {
    await database.close();
  }
});
