import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "worker-registration-flow-sql-test",
  sessionSecret:
    "worker-registration-session-secret-with-at-least-thirty-two-characters",
  authPepper:
    "worker-registration-auth-pepper-with-at-least-thirty-two-characters",
  authSandboxEnabled: true,
  authSandboxAccessKey: "worker-registration-sandbox-key",
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const ADVANCE_FLOW_SQL = `UPDATE auth_registration_flows
 SET current_step = $3,
     completed_at = CASE
       WHEN $3 = 'complete' THEN $4::timestamptz
       ELSE NULL::timestamptz
     END,
     updated_at = $4::timestamptz
 WHERE account_id = $1
   AND current_step = $2`;

test("registration flow SQL preserves typed timestamps across both OTP stages", async () => {
  const repositorySource = await readFile(
    resolve("src/lib/auth/worker-registration-repository.ts"),
    "utf8"
  );
  assert.match(repositorySource, /THEN \$4::timestamptz/);
  assert.match(repositorySource, /ELSE NULL::timestamptz/);
  assert.match(repositorySource, /updated_at = \$4::timestamptz/);
  assert.doesNotMatch(
    repositorySource,
    /completed_at = CASE WHEN \$3 = 'complete' THEN \$4 ELSE NULL END/
  );

  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const createdAt = "2026-08-04T06:00:00.000Z";
    const expiresAt = "2026-08-04T07:00:00.000Z";
    const accountId = "account_registration_flow_cast";

    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, phone_e164, display_name,
         account_status, password_hash, worker_reference, password_set_at,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'pending_email', $5, $6, $7, $7, $7)`,
      [
        accountId,
        "flow-cast@example.com",
        "+923001112233",
        "Flow Cast Worker",
        "scrypt$16384$8$1$not-plaintext$not-plaintext",
        "HSE-REG-FLOWCAST0001",
        createdAt
      ]
    );
    await database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'worker', $2)`,
      [accountId, createdAt]
    );
    await database.query(
      `INSERT INTO auth_registration_flows (
         flow_id, account_id, token_hash, current_step, expires_at,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'pending_email', $4, $5, $5)`,
      [
        "registration_flow_cast",
        accountId,
        "registration-flow-cast-token-hash",
        expiresAt,
        createdAt
      ]
    );

    const emailVerifiedAt = "2026-08-04T06:05:00.000Z";
    const emailAdvance = await database.query(ADVANCE_FLOW_SQL, [
      accountId,
      "pending_email",
      "pending_phone",
      emailVerifiedAt
    ]);
    assert.equal(emailAdvance.affectedRows, 1);

    const pendingPhone = await database.query(
      `SELECT current_step, completed_at, updated_at
       FROM auth_registration_flows
       WHERE account_id = $1`,
      [accountId]
    );
    assert.equal(pendingPhone.rows[0].current_step, "pending_phone");
    assert.equal(pendingPhone.rows[0].completed_at, null);
    assert.equal(
      new Date(pendingPhone.rows[0].updated_at).toISOString(),
      emailVerifiedAt
    );

    const phoneVerifiedAt = "2026-08-04T06:10:00.000Z";
    const completion = await database.query(ADVANCE_FLOW_SQL, [
      accountId,
      "pending_phone",
      "complete",
      phoneVerifiedAt
    ]);
    assert.equal(completion.affectedRows, 1);

    const complete = await database.query(
      `SELECT current_step, completed_at, updated_at
       FROM auth_registration_flows
       WHERE account_id = $1`,
      [accountId]
    );
    assert.equal(complete.rows[0].current_step, "complete");
    assert.equal(
      new Date(complete.rows[0].completed_at).toISOString(),
      phoneVerifiedAt
    );
    assert.equal(
      new Date(complete.rows[0].updated_at).toISOString(),
      phoneVerifiedAt
    );
  } finally {
    await database.close();
  }
});
