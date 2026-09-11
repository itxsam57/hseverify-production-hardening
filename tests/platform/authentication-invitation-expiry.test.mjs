import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const TEST_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "authentication-invitation-expiry-test",
  sessionSecret:
    "authentication-invitation-expiry-session-secret-at-least-thirty-two-characters",
  authPepper:
    "authentication-invitation-expiry-pepper-at-least-thirty-two-characters",
  authSandboxEnabled: true,
  authSandboxAccessKey: "authentication-invitation-expiry-sandbox-key",
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

test("expired pending staff invitations are retired before a replacement insert", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const clock = Date.now();
    const oldCreatedAt = new Date(clock - 2 * DAY_MS).toISOString();
    const oldExpiresAt = new Date(clock - DAY_MS).toISOString();
    const replacementCreatedAt = new Date(clock - MINUTE_MS).toISOString();
    const replacementExpiresAt = new Date(clock + DAY_MS).toISOString();

    await database.query(
      `INSERT INTO auth_staff_invitations (
         invitation_id, email_normalized, role, token_hash,
         invitation_status, invited_by_account_id, expires_at, created_at
       ) VALUES ($1, $2, 'root', $3, 'pending', NULL, $4, $5)`,
      [
        "expired_root_invitation",
        "root@example.com",
        "expired-root-token",
        oldExpiresAt,
        oldCreatedAt
      ]
    );

    await database.query(
      `INSERT INTO auth_staff_invitations (
         invitation_id, email_normalized, role, token_hash,
         invitation_status, invited_by_account_id, expires_at, created_at
       ) VALUES ($1, $2, 'root', $3, 'pending', NULL, $4, $5)`,
      [
        "replacement_root_invitation",
        "replacement-root@example.com",
        "replacement-root-token",
        replacementExpiresAt,
        replacementCreatedAt
      ]
    );

    const rows = await database.query(
      `SELECT invitation_id, invitation_status
       FROM auth_staff_invitations
       WHERE invitation_id IN ($1, $2)
       ORDER BY invitation_id`,
      ["expired_root_invitation", "replacement_root_invitation"]
    );
    assert.deepEqual(
      rows.rows.map((row) => [row.invitation_id, row.invitation_status]),
      [
        ["expired_root_invitation", "expired"],
        ["replacement_root_invitation", "pending"]
      ]
    );
  } finally {
    await database.close();
  }
});

test("an unexpired pending root bootstrap still rejects a concurrent replacement", async () => {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
    const clock = Date.now();
    const createdAt = new Date(clock - MINUTE_MS).toISOString();
    const expiresAt = new Date(clock + DAY_MS).toISOString();
    await database.query(
      `INSERT INTO auth_staff_invitations (
         invitation_id, email_normalized, role, token_hash,
         invitation_status, invited_by_account_id, expires_at, created_at
       ) VALUES ($1, $2, 'root', $3, 'pending', NULL, $4, $5)`,
      ["active_root_one", "active-root@example.com", "active-root-one", expiresAt, createdAt]
    );

    await assert.rejects(
      database.query(
        `INSERT INTO auth_staff_invitations (
           invitation_id, email_normalized, role, token_hash,
           invitation_status, invited_by_account_id, expires_at, created_at
         ) VALUES ($1, $2, 'root', $3, 'pending', NULL, $4, $5)`,
        [
          "active_root_two",
          "active-root-two@example.com",
          "active-root-two",
          expiresAt,
          createdAt
        ]
      ),
      /auth_single_pending_root_bootstrap_idx|unique|duplicate/i
    );
  } finally {
    await database.close();
  }
});