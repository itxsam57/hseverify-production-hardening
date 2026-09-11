import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-05-final-concurrency",
  sessionSecret: "m1-05-final-concurrency-session-secret-32-characters",
  authPepper: "m1-05-final-concurrency-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function opaque(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

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
  const [outbox, notification, email] = await Promise.all([
    readFile(resolve("src/lib/outbox/outbox-repository.ts"), "utf8"),
    readFile(resolve("src/lib/notifications/notification-repository.ts"), "utf8"),
    readFile(resolve("src/lib/email-delivery/email-delivery-repository.ts"), "utf8")
  ]);
  return {
    candidate: extractSql(outbox, "OUTBOX_CLAIM_CANDIDATE_SQL"),
    expiredAttempt: extractSql(outbox, "OUTBOX_MARK_EXPIRED_ATTEMPT_SQL"),
    lease: extractSql(outbox, "OUTBOX_LEASE_JOB_SQL"),
    attempt: extractSql(outbox, "OUTBOX_INSERT_ATTEMPT_SQL"),
    succeedJob: extractSql(outbox, "OUTBOX_SUCCEED_JOB_SQL"),
    succeedAttempt: extractSql(outbox, "OUTBOX_SUCCEED_ATTEMPT_SQL"),
    notificationInsert: extractSql(notification, "NOTIFICATION_INSERT_SQL"),
    emailQueue: extractSql(email, "EMAIL_QUEUE_SQL")
  };
}

async function insertWorker(database) {
  const accountId = "account_m105_final_concurrency";
  const email = "m105-final-concurrency@example.com";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, 'M1.05 Final Concurrency', 'active',
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [accountId, email]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', CURRENT_TIMESTAMP)`,
    [accountId]
  );
  return { accountId, email };
}

async function insertJob(database, input) {
  const jobId = opaque("job", input.character);
  const payload = input.jobType === "notification.portal.foundation"
    ? { fixtureRef: `fixture_${input.character}` }
    : { fixtureRef: `email.foundation.success.${input.character}` };
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, $2, 1, $3, $4::jsonb, $5, 'worker', NULL, NULL)`,
    [
      jobId,
      input.jobType,
      hash(`${input.jobType}:${input.character}:${input.accountId}`),
      JSON.stringify(payload),
      input.accountId
    ]
  );
  return jobId;
}

async function claim(database, sql, character) {
  return database.transaction(async (transaction) => {
    const candidate = await transaction.query(sql.candidate);
    const row = candidate.rows[0];
    if (!row) return null;

    if (row.status === "leased") {
      const expired = await transaction.query(sql.expiredAttempt, [
        row.job_id,
        row.lease_id,
        "lease_expired",
        "lease_expired",
        "The worker lease expired before completion."
      ]);
      assert.equal(expired.rows.length, 1);
    }

    const leaseId = opaque("lease", character);
    const workerId = opaque("outbox_worker", character);
    const leased = await transaction.query(sql.lease, [
      row.job_id,
      leaseId,
      workerId,
      60
    ]);
    if (!leased.rows[0]) return null;

    const attemptNumber = Number(leased.rows[0].attempt_count);
    const attemptId = opaque(
      "attempt",
      String.fromCharCode(character.charCodeAt(0) + 8)
    );
    await transaction.query(sql.attempt, [
      attemptId,
      row.job_id,
      attemptNumber,
      workerId,
      leaseId
    ]);
    return {
      jobId: row.job_id,
      jobType: row.job_type,
      attemptId,
      attemptNumber,
      workerId,
      leaseId
    };
  });
}

test("mixed notification and email jobs preserve one lease owner and one durable effect across crash reclaim", async () => {
  const sql = await contracts();
  assert.match(sql.candidate, /FOR UPDATE SKIP LOCKED/);

  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const worker = await insertWorker(database);
    const notificationJob = await insertJob(database, {
      character: "T",
      jobType: "notification.portal.foundation",
      accountId: worker.accountId
    });
    const emailJob = await insertJob(database, {
      character: "U",
      jobType: "email.delivery.foundation",
      accountId: worker.accountId
    });

    const notificationProjectionKey = hash(`notification:T:${worker.accountId}`);
    const insertedNotification = await database.query(sql.notificationInsert, [
      opaque("notification", "T"),
      "platform.foundation.ready",
      1,
      notificationJob,
      notificationProjectionKey,
      worker.accountId,
      "worker",
      null,
      null,
      "Notification foundation ready",
      "This persisted notification verifies the current portal notification channel.",
      JSON.stringify({ fixtureRef: "fixture_T" }),
      "portal.dashboard",
      null
    ]);
    assert.equal(insertedNotification.rows.length, 1);

    const deliveryKey = hash(`delivery:U:${worker.accountId}`);
    const insertedDelivery = await database.query(sql.emailQueue, [
      opaque("email_delivery", "U"),
      1,
      emailJob,
      deliveryKey,
      worker.accountId,
      "worker",
      null,
      null,
      hash(worker.email)
    ]);
    assert.equal(insertedDelivery.rows.length, 1);

    const firstClaims = (
      await Promise.all([
        claim(database, sql, "V"),
        claim(database, sql, "W")
      ])
    ).filter(Boolean);
    assert.equal(firstClaims.length, 2);
    assert.equal(new Set(firstClaims.map((item) => item.jobId)).size, 2);
    assert.deepEqual(
      new Set(firstClaims.map((item) => item.jobType)),
      new Set(["notification.portal.foundation", "email.delivery.foundation"])
    );

    const emailFirst = firstClaims.find((item) => item.jobId === emailJob);
    const notificationFirst = firstClaims.find((item) => item.jobId === notificationJob);
    assert.ok(emailFirst);
    assert.ok(notificationFirst);

    await database.query(
      `UPDATE platform_outbox_jobs
       SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE job_id = $1`,
      [emailFirst.jobId]
    );

    const emailReplacement = await claim(database, sql, "X");
    assert.ok(emailReplacement);
    assert.equal(emailReplacement.jobId, emailJob);
    assert.equal(emailReplacement.attemptNumber, 2);
    assert.notEqual(emailReplacement.leaseId, emailFirst.leaseId);

    const staleCompletion = await database.query(sql.succeedJob, [
      emailFirst.jobId,
      emailFirst.leaseId,
      emailFirst.workerId
    ]);
    assert.equal(staleCompletion.rows.length, 0);

    const oldAttempt = await database.query(
      `SELECT outcome
       FROM platform_outbox_job_attempts
       WHERE attempt_id = $1`,
      [emailFirst.attemptId]
    );
    assert.equal(oldAttempt.rows[0].outcome, "lease_expired");

    const duplicateNotification = await database.query(sql.notificationInsert, [
      opaque("notification", "Y"),
      "platform.foundation.ready",
      1,
      notificationJob,
      notificationProjectionKey,
      worker.accountId,
      "worker",
      null,
      null,
      "Notification foundation ready",
      "This persisted notification verifies the current portal notification channel.",
      JSON.stringify({ fixtureRef: "fixture_T" }),
      "portal.dashboard",
      null
    ]);
    assert.equal(duplicateNotification.rows.length, 0);

    const duplicateDelivery = await database.query(sql.emailQueue, [
      opaque("email_delivery", "Z"),
      1,
      emailJob,
      deliveryKey,
      worker.accountId,
      "worker",
      null,
      null,
      hash(worker.email)
    ]);
    assert.equal(duplicateDelivery.rows.length, 0);

    const emailSucceeded = await database.query(sql.succeedJob, [
      emailReplacement.jobId,
      emailReplacement.leaseId,
      emailReplacement.workerId
    ]);
    assert.equal(emailSucceeded.rows[0].status, "succeeded");
    const emailAttemptSucceeded = await database.query(sql.succeedAttempt, [
      emailReplacement.attemptId,
      emailReplacement.jobId,
      emailReplacement.leaseId,
      emailReplacement.workerId
    ]);
    assert.equal(emailAttemptSucceeded.rows[0].outcome, "succeeded");

    const notificationSucceeded = await database.query(sql.succeedJob, [
      notificationFirst.jobId,
      notificationFirst.leaseId,
      notificationFirst.workerId
    ]);
    assert.equal(notificationSucceeded.rows[0].status, "succeeded");
    const notificationAttemptSucceeded = await database.query(sql.succeedAttempt, [
      notificationFirst.attemptId,
      notificationFirst.jobId,
      notificationFirst.leaseId,
      notificationFirst.workerId
    ]);
    assert.equal(notificationAttemptSucceeded.rows[0].outcome, "succeeded");

    const durableEffects = await Promise.all([
      database.query(
        "SELECT COUNT(*)::int AS count FROM platform_notifications WHERE projection_key = $1",
        [notificationProjectionKey]
      ),
      database.query(
        "SELECT COUNT(*)::int AS count FROM platform_email_deliveries WHERE delivery_key = $1",
        [deliveryKey]
      ),
      database.query(
        "SELECT COUNT(*)::int AS count FROM platform_outbox_job_attempts WHERE job_id = $1",
        [emailJob]
      )
    ]);
    assert.equal(Number(durableEffects[0].rows[0].count), 1);
    assert.equal(Number(durableEffects[1].rows[0].count), 1);
    assert.equal(Number(durableEffects[2].rows[0].count), 2);
  } finally {
    await database.close();
  }
});
