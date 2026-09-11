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
  releaseSha: "worker-registration-concurrency-test",
  sessionSecret:
    "worker-registration-concurrency-secret-with-at-least-thirty-two-characters",
  authPepper:
    "worker-registration-concurrency-pepper-with-at-least-thirty-two-characters",
  authSandboxEnabled: true,
  authSandboxAccessKey: "worker-registration-sandbox-key",
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function openMigratedDatabase() {
  const database = await openScriptDatabase(TEST_ENVIRONMENT);
  await applyPendingMigrations(database, TEST_ENVIRONMENT.releaseSha);
  return database;
}

async function insertPendingAccount(database) {
  const now = new Date("2026-08-02T18:00:00.000Z").toISOString();
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name,
       account_status, password_hash, worker_reference, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'pending_email', $5, $6, $7, $7, $7)`,
    [
      "acct_concurrency",
      "concurrency@example.com",
      "+923001112222",
      "Concurrency Worker",
      "scrypt$16384$8$1$salt$hash",
      "HSE-REG-CONCURRENT1",
      now
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    ["acct_concurrency", now]
  );
  return now;
}

function otpParameters(challengeId, now, offset = 0) {
  const base = new Date(now).getTime() + offset;
  return [
    challengeId,
    "acct_concurrency",
    `destination-${challengeId}`,
    "c**********@example.com",
    `hash-${challengeId}`,
    new Date(base + 60_000).toISOString(),
    new Date(base + 600_000).toISOString(),
    new Date(base).toISOString()
  ];
}

test("database permits only one active OTP per account and purpose", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = await insertPendingAccount(database);
    const insertSql = `INSERT INTO auth_otp_challenges (
       challenge_id, account_id, purpose, channel, destination_hash,
       delivery_hint, code_hash, attempts_remaining,
       resend_available_at, expires_at, created_at
     ) VALUES ($1, $2, 'registration_email', 'email', $3, $4, $5, 5, $6, $7, $8)`;

    await database.query(insertSql, otpParameters("otp_concurrency_one", now));
    await assert.rejects(
      database.query(
        insertSql,
        otpParameters("otp_concurrency_two", now, 1_000)
      ),
      /auth_active_otp_challenge_idx|unique|duplicate/i
    );

    await database.query(
      `UPDATE auth_otp_challenges
       SET consumed_at = $2
       WHERE challenge_id = $1`,
      ["otp_concurrency_one", new Date(new Date(now).getTime() + 2_000).toISOString()]
    );

    await database.query(
      insertSql,
      otpParameters("otp_concurrency_two", now, 3_000)
    );
    const active = await database.query(
      `SELECT challenge_id
       FROM auth_otp_challenges
       WHERE account_id = $1
         AND purpose = 'registration_email'
         AND consumed_at IS NULL
         AND invalidated_at IS NULL`,
      ["acct_concurrency"]
    );
    assert.deepEqual(
      active.rows.map((row) => row.challenge_id),
      ["otp_concurrency_two"]
    );
  } finally {
    await database.close();
  }
});

async function consumeRateBucket(database, bucketKey, now, resetBefore) {
  const result = await database.query(
    `INSERT INTO auth_rate_limit_buckets (
       action, bucket_key, window_started_at, attempt_count, updated_at
     ) VALUES ('worker_registration_start', $1, $2, 1, $2)
     ON CONFLICT (action, bucket_key) DO UPDATE
     SET window_started_at = CASE
           WHEN auth_rate_limit_buckets.window_started_at <= $3 THEN $2
           ELSE auth_rate_limit_buckets.window_started_at
         END,
         attempt_count = CASE
           WHEN auth_rate_limit_buckets.window_started_at <= $3 THEN 1
           ELSE auth_rate_limit_buckets.attempt_count + 1
         END,
         updated_at = $2
     RETURNING attempt_count`,
    [bucketKey, now, resetBefore]
  );
  return result.rows[0]?.attempt_count;
}

test("registration rate bucket increments atomically and resets after its window", async () => {
  const database = await openMigratedDatabase();
  try {
    const now = new Date("2026-08-02T18:00:00.000Z");
    const resetBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const counts = [];
    for (let index = 0; index < 6; index += 1) {
      counts.push(
        await consumeRateBucket(
          database,
          "registration-fingerprint",
          new Date(now.getTime() + index * 1_000).toISOString(),
          resetBefore
        )
      );
    }
    assert.deepEqual(counts, [1, 2, 3, 4, 5, 6]);

    const forcedOld = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    await database.query(
      `UPDATE auth_rate_limit_buckets
       SET window_started_at = $2
       WHERE action = 'worker_registration_start' AND bucket_key = $1`,
      ["registration-fingerprint", forcedOld]
    );
    assert.equal(
      await consumeRateBucket(
        database,
        "registration-fingerprint",
        new Date(now.getTime() + 7_000).toISOString(),
        resetBefore
      ),
      1
    );
  } finally {
    await database.close();
  }
});

test("repository uses the atomic bucket and service rate-limits before password hashing", async () => {
  const repository = await readFile(
    resolve("src/lib/auth/worker-registration-repository.ts"),
    "utf8"
  );
  const service = await readFile(
    resolve("src/lib/auth/worker-registration-service.ts"),
    "utf8"
  );
  const migration = await readFile(
    resolve("database/migrations/0003_worker_registration_otp.up.sql"),
    "utf8"
  );

  assert.match(repository, /consumeRegistrationStartRateLimit/);
  assert.match(repository, /auth_rate_limit_buckets/);
  assert.match(repository, /ON CONFLICT \(action, bucket_key\) DO UPDATE/);
  assert.match(repository, /VALUES \('worker_registration_start', \$1, \$2, 1, \$2\)/);
  assert.match(service, /attemptCount <= MAX_REGISTRATION_STARTS_PER_WINDOW/);
  assert.ok(
    service.indexOf("await this.enforceStartRateLimit") <
      service.indexOf("const passwordHash = await hashPassword")
  );
  assert.match(migration, /auth_active_otp_challenge_idx/);
  assert.match(migration, /auth_rate_limit_buckets/);
});
