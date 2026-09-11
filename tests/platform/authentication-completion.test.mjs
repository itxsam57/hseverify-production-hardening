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
  releaseSha: "authentication-completion-test",
  sessionSecret:
    "authentication-completion-session-secret-with-at-least-thirty-two-characters",
  authPepper:
    "authentication-completion-auth-pepper-with-at-least-thirty-two-characters",
  authSandboxEnabled: true,
  authSandboxAccessKey: "authentication-completion-sandbox-key",
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function openMigratedDatabase() {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
  return database;
}

async function insertActiveAccount(database, input) {
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`,
    [
      input.accountId,
      input.email,
      input.displayName,
      "scrypt$16384$8$1$salt$hash",
      input.now
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, $3)`,
    [input.accountId, input.role, input.now]
  );
}

test("completion migration creates recovery, enrollment and persistent rate-limit boundaries", async () => {
  const database = await openMigratedDatabase();
  try {
    const tables = await database.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'auth_recovery_flows',
           'auth_staff_enrollment_flows',
           'auth_access_rate_limits'
         )
       ORDER BY table_name`
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      [
        "auth_access_rate_limits",
        "auth_recovery_flows",
        "auth_staff_enrollment_flows"
      ]
    );

    const clock = Date.now();
    const now = new Date(clock - 60_000).toISOString();
    const expiresAt = new Date(clock + 86_400_000).toISOString();
    await database.query(
      `INSERT INTO auth_staff_invitations (
         invitation_id, email_normalized, role, token_hash,
         invitation_status, invited_by_account_id, expires_at, created_at
       ) VALUES ($1, $2, 'root', $3, 'pending', NULL, $4, $5)`,
      ["bootstrap_one", "root-one@example.com", "root-token-one", expiresAt, now]
    );
    await assert.rejects(
      database.query(
        `INSERT INTO auth_staff_invitations (
           invitation_id, email_normalized, role, token_hash,
           invitation_status, invited_by_account_id, expires_at, created_at
         ) VALUES ($1, $2, 'root', $3, 'pending', NULL, $4, $5)`,
        ["bootstrap_two", "root-two@example.com", "root-token-two", expiresAt, now]
      ),
      /auth_single_pending_root_bootstrap_idx|unique|duplicate/i
    );
  } finally {
    await database.close();
  }
});

test("password recovery flow and OTP consumption are one-time", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = new Date("2026-08-03T04:00:00.000Z").toISOString();
    const resendAt = new Date("2026-08-03T04:01:00.000Z").toISOString();
    const expiresAt = new Date("2026-08-03T04:10:00.000Z").toISOString();
    const flowExpiresAt = new Date("2026-08-03T04:20:00.000Z").toISOString();
    await insertActiveAccount(database, {
      accountId: "acct_recovery_test",
      email: "recovery@example.com",
      displayName: "Recovery Test",
      role: "worker",
      now
    });
    await database.query(
      `INSERT INTO auth_otp_challenges (
         challenge_id, account_id, purpose, channel, destination_hash,
         delivery_hint, code_hash, attempts_remaining,
         resend_available_at, expires_at, created_at
       ) VALUES ($1, $2, 'password_reset', 'email', $3, $4, $5, 5, $6, $7, $8)`,
      [
        "otp_recovery_test",
        "acct_recovery_test",
        "recovery-destination-hash",
        "r******y@example.com",
        "recovery-code-hash",
        resendAt,
        expiresAt,
        now
      ]
    );
    await database.query(
      `INSERT INTO auth_recovery_flows (
         flow_id, account_id, active_role, token_hash, challenge_id,
         expires_at, created_at, updated_at
       ) VALUES ($1, $2, 'worker', $3, $4, $5, $6, $6)`,
      [
        "recovery_flow_test",
        "acct_recovery_test",
        "recovery-flow-token-hash",
        "otp_recovery_test",
        flowExpiresAt,
        now
      ]
    );

    const consumedOtp = await database.query(
      `UPDATE auth_otp_challenges
       SET consumed_at = $2
       WHERE challenge_id = $1
         AND consumed_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > $2
       RETURNING challenge_id`,
      ["otp_recovery_test", now]
    );
    const consumedFlow = await database.query(
      `UPDATE auth_recovery_flows
       SET consumed_at = $2, updated_at = $2
       WHERE flow_id = $1
         AND consumed_at IS NULL
         AND expires_at > $2
       RETURNING flow_id`,
      ["recovery_flow_test", now]
    );
    assert.equal(consumedOtp.rows.length, 1);
    assert.equal(consumedFlow.rows.length, 1);

    const replayOtp = await database.query(
      `UPDATE auth_otp_challenges
       SET consumed_at = $2
       WHERE challenge_id = $1
         AND consumed_at IS NULL
       RETURNING challenge_id`,
      ["otp_recovery_test", new Date("2026-08-03T04:00:01.000Z").toISOString()]
    );
    const replayFlow = await database.query(
      `UPDATE auth_recovery_flows
       SET consumed_at = $2
       WHERE flow_id = $1
         AND consumed_at IS NULL
       RETURNING flow_id`,
      ["recovery_flow_test", new Date("2026-08-03T04:00:01.000Z").toISOString()]
    );
    assert.equal(replayOtp.rows.length, 0);
    assert.equal(replayFlow.rows.length, 0);
  } finally {
    await database.close();
  }
});

test("staff enrollment requires consistent state and TOTP counters cannot replay", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = new Date("2026-08-03T04:00:00.000Z").toISOString();
    const expiresAt = new Date("2026-08-05T04:00:00.000Z").toISOString();
    await database.query(
      `INSERT INTO auth_staff_invitations (
         invitation_id, email_normalized, role, token_hash,
         invitation_status, expires_at, created_at
       ) VALUES ($1, $2, 'admin', $3, 'pending', $4, $5)`,
      ["invite_admin_test", "admin@example.com", "invite-admin-token", expiresAt, now]
    );
    await assert.rejects(
      database.query(
        `INSERT INTO auth_staff_enrollment_flows (
           flow_id, invitation_id, token_hash, current_step,
           expires_at, created_at, updated_at
         ) VALUES ($1, $2, $3, 'totp', $4, $5, $5)`,
        ["invalid_enrollment", "invite_admin_test", "invalid-flow-token", expiresAt, now]
      ),
      /auth_staff_enrollment_state_check|check constraint|violates/i
    );

    await insertActiveAccount(database, {
      accountId: "acct_admin_test",
      email: "active-admin@example.com",
      displayName: "Active Admin",
      role: "admin",
      now
    });
    await database.query(
      `INSERT INTO auth_mfa_factors (
         factor_id, account_id, factor_type, encrypted_secret,
         factor_status, last_accepted_counter, created_at, activated_at
       ) VALUES ($1, $2, 'totp', $3, 'active', 10, $4, $4)`,
      ["factor_admin_test", "acct_admin_test", "encrypted-secret", now]
    );
    const replay = await database.query(
      `UPDATE auth_mfa_factors
       SET last_accepted_counter = $2
       WHERE factor_id = $1
         AND factor_status = 'active'
         AND last_accepted_counter < $2
       RETURNING factor_id`,
      ["factor_admin_test", 10]
    );
    const fresh = await database.query(
      `UPDATE auth_mfa_factors
       SET last_accepted_counter = $2
       WHERE factor_id = $1
         AND factor_status = 'active'
         AND last_accepted_counter < $2
       RETURNING factor_id`,
      ["factor_admin_test", 11]
    );
    assert.equal(replay.rows.length, 0);
    assert.equal(fresh.rows.length, 1);
  } finally {
    await database.close();
  }
});

test("revoked sessions stop resolving while other owned sessions remain", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = new Date("2026-08-03T04:00:00.000Z").toISOString();
    const expiresAt = new Date("2026-08-03T12:00:00.000Z").toISOString();
    await insertActiveAccount(database, {
      accountId: "acct_session_test",
      email: "sessions@example.com",
      displayName: "Session Test",
      role: "worker",
      now
    });
    for (const suffix of ["one", "two"]) {
      await database.query(
        `INSERT INTO auth_sessions (
           session_id, account_id, active_role, token_hash, csrf_token_hash,
           created_at, last_seen_at, expires_at
         ) VALUES ($1, $2, 'worker', $3, $4, $5, $5, $6)`,
        [
          `session_${suffix}`,
          "acct_session_test",
          `session-token-${suffix}`,
          `session-csrf-${suffix}`,
          now,
          expiresAt
        ]
      );
    }
    const revoked = await database.query(
      `UPDATE auth_sessions
       SET revoked_at = $2, revocation_reason = 'user_revoked'
       WHERE session_id = $1 AND revoked_at IS NULL
       RETURNING session_id`,
      ["session_one", now]
    );
    assert.equal(revoked.rows.length, 1);

    const active = await database.query(
      `SELECT session_id
       FROM auth_sessions
       WHERE account_id = $1
         AND revoked_at IS NULL
         AND expires_at > $2
       ORDER BY session_id`,
      ["acct_session_test", now]
    );
    assert.deepEqual(active.rows.map((row) => row.session_id), ["session_two"]);
  } finally {
    await database.close();
  }
});

test("completion source keeps opaque sessions, all-session reset and MFA enforcement explicit", async () => {
  const [sessionCookie, sessionService, loginService, recoveryService, staffService] =
    await Promise.all([
      readFile(resolve("src/lib/auth/auth-session-cookie.ts"), "utf8"),
      readFile(resolve("src/lib/auth/auth-session-service.ts"), "utf8"),
      readFile(resolve("src/lib/auth/auth-login-service.ts"), "utf8"),
      readFile(resolve("src/lib/auth/auth-recovery-service.ts"), "utf8"),
      readFile(resolve("src/lib/auth/staff-provisioning-service.ts"), "utf8")
    ]);

  assert.match(sessionCookie, /httpOnly: true/);
  assert.match(sessionCookie, /__Host-hse_session/);
  assert.doesNotMatch(sessionCookie, /accountId|activeRole|displayName|email/);
  assert.match(sessionService, /findActiveSessionByTokenHash/);
  assert.match(sessionService, /revokeSession/);
  assert.match(sessionService, /requireRoleSession/);
  assert.doesNotMatch(sessionService, /switchRole|changeRole/);

  assert.match(loginService, /roleRequiresMfa/);
  assert.match(loginService, /findActiveMfaFactorForUpdate/);
  assert.match(loginService, /acceptMfaCounter/);
  assert.match(loginService, /recordLoginFailure/);
  assert.match(loginService, /consumeAccessRateLimit/);

  assert.match(recoveryService, /consumeOtpChallenge/);
  assert.match(recoveryService, /consumeRecoveryFlow/);
  assert.match(recoveryService, /revokeAllSessions/);
  assert.match(recoveryService, /password_reset_completed/);

  assert.match(staffService, /createRootBootstrapInvitation/);
  assert.match(staffService, /countRoleAssignments\("root"\)/);
  assert.match(staffService, /createTotpSecret/);
  assert.match(staffService, /activateMfaFactor/);
  assert.match(staffService, /markInvitationAccepted/);
});
