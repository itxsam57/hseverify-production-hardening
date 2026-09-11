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
  releaseSha: "authentication-failure-state-sql-test",
  sessionSecret:
    "authentication-failure-session-secret-with-at-least-thirty-two-characters",
  authPepper:
    "authentication-failure-auth-pepper-with-at-least-thirty-two-characters",
  authSandboxEnabled: true,
  authSandboxAccessKey: "authentication-failure-sandbox-key",
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const RECORD_LOGIN_FAILURE_SQL = `UPDATE auth_accounts
 SET failed_sign_in_count = failed_sign_in_count + 1,
     account_status = CASE
       WHEN failed_sign_in_count + 1 >= $3 THEN 'locked'
       ELSE account_status
     END,
     locked_until = CASE
       WHEN failed_sign_in_count + 1 >= $3 THEN $4::timestamptz
       ELSE NULL::timestamptz
     END,
     updated_at = $2::timestamptz
 WHERE account_id = $1
   AND account_status = 'active'
 RETURNING failed_sign_in_count, account_status, locked_until, updated_at`;

const RECORD_OTP_FAILURE_SQL = `UPDATE auth_otp_challenges
 SET attempts_remaining = GREATEST(attempts_remaining - 1, 0),
     invalidated_at = CASE
       WHEN attempts_remaining <= 1 THEN $2::timestamptz
       ELSE invalidated_at
     END
 WHERE challenge_id = $1
   AND consumed_at IS NULL
   AND invalidated_at IS NULL
 RETURNING attempts_remaining, invalidated_at`;

test("authentication failure SQL persists lockout and OTP terminal timestamps", async () => {
  const repositorySource = await readFile(
    resolve("src/lib/auth/auth-repository.ts"),
    "utf8"
  );

  assert.match(repositorySource, /THEN \$4::timestamptz/);
  assert.match(repositorySource, /ELSE NULL::timestamptz/);
  assert.match(repositorySource, /updated_at = \$2::timestamptz/);
  assert.match(repositorySource, /THEN \$2::timestamptz/);
  assert.doesNotMatch(
    repositorySource,
    /locked_until = CASE[\s\S]*?THEN \$4\s*\n\s*ELSE NULL/
  );
  assert.doesNotMatch(
    repositorySource,
    /invalidated_at = CASE[\s\S]*?THEN \$2\s*\n\s*ELSE invalidated_at/
  );

  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  try {
    await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);

    const accountId = "account_lockout_timestamp_test";
    const createdAt = "2026-08-04T07:00:00.000Z";
    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         password_hash, email_verified_at, password_set_at,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
      [
        accountId,
        "lockout-timestamp@example.com",
        "Lockout Timestamp Worker",
        "scrypt$16384$8$1$not-plaintext$not-plaintext",
        createdAt
      ]
    );
    await database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'worker', $2)`,
      [accountId, createdAt]
    );

    const lockUntil = "2026-08-04T07:20:00.000Z";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const failedAt = new Date(
        Date.parse(createdAt) + attempt * 60_000
      ).toISOString();
      const result = await database.query(RECORD_LOGIN_FAILURE_SQL, [
        accountId,
        failedAt,
        5,
        lockUntil
      ]);
      assert.equal(result.affectedRows, 1);
      assert.equal(result.rows[0].failed_sign_in_count, attempt);
      assert.equal(
        result.rows[0].account_status,
        attempt === 5 ? "locked" : "active"
      );
      if (attempt < 5) {
        assert.equal(result.rows[0].locked_until, null);
      } else {
        assert.equal(
          new Date(result.rows[0].locked_until).toISOString(),
          lockUntil
        );
      }
      assert.equal(
        new Date(result.rows[0].updated_at).toISOString(),
        failedAt
      );
    }

    const blockedSixthUpdate = await database.query(
      RECORD_LOGIN_FAILURE_SQL,
      [
        accountId,
        "2026-08-04T07:06:00.000Z",
        5,
        "2026-08-04T07:21:00.000Z"
      ]
    );
    assert.equal(blockedSixthUpdate.affectedRows, 0);

    const lockedAccount = await database.query(
      `SELECT failed_sign_in_count, account_status, locked_until
       FROM auth_accounts
       WHERE account_id = $1`,
      [accountId]
    );
    assert.equal(lockedAccount.rows[0].failed_sign_in_count, 5);
    assert.equal(lockedAccount.rows[0].account_status, "locked");
    assert.equal(
      new Date(lockedAccount.rows[0].locked_until).toISOString(),
      lockUntil
    );

    const clearedAt = "2026-08-04T07:07:00.000Z";
    const cleared = await database.query(
      `UPDATE auth_accounts
       SET failed_sign_in_count = 0,
           locked_until = NULL,
           account_status = 'active',
           updated_at = $2
       WHERE account_id = $1
         AND account_status IN ('active', 'locked')
       RETURNING failed_sign_in_count, account_status, locked_until`,
      [accountId, clearedAt]
    );
    assert.equal(cleared.rows[0].failed_sign_in_count, 0);
    assert.equal(cleared.rows[0].account_status, "active");
    assert.equal(cleared.rows[0].locked_until, null);

    const challengeId = "otp_failure_timestamp_test";
    const resendAt = "2026-08-04T07:01:00.000Z";
    const expiresAt = "2026-08-04T07:10:00.000Z";
    await database.query(
      `INSERT INTO auth_otp_challenges (
         challenge_id, account_id, purpose, channel, destination_hash,
         delivery_hint, code_hash, attempts_remaining,
         resend_available_at, expires_at, created_at
       ) VALUES ($1, $2, 'password_reset', 'email', $3, $4, $5, 2, $6, $7, $8)`,
      [
        challengeId,
        accountId,
        "otp-failure-destination-hash",
        "l******t@example.com",
        "otp-failure-code-hash",
        resendAt,
        expiresAt,
        createdAt
      ]
    );

    const firstOtpFailureAt = "2026-08-04T07:02:00.000Z";
    const firstOtpFailure = await database.query(RECORD_OTP_FAILURE_SQL, [
      challengeId,
      firstOtpFailureAt
    ]);
    assert.equal(firstOtpFailure.rows[0].attempts_remaining, 1);
    assert.equal(firstOtpFailure.rows[0].invalidated_at, null);

    const secondOtpFailureAt = "2026-08-04T07:03:00.000Z";
    const secondOtpFailure = await database.query(RECORD_OTP_FAILURE_SQL, [
      challengeId,
      secondOtpFailureAt
    ]);
    assert.equal(secondOtpFailure.rows[0].attempts_remaining, 0);
    assert.equal(
      new Date(secondOtpFailure.rows[0].invalidated_at).toISOString(),
      secondOtpFailureAt
    );

    const terminalOtpFailure = await database.query(RECORD_OTP_FAILURE_SQL, [
      challengeId,
      "2026-08-04T07:04:00.000Z"
    ]);
    assert.equal(terminalOtpFailure.affectedRows, 0);
  } finally {
    await database.close();
  }
});
