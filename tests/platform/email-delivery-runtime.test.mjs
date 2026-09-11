import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_EMAIL_DELIVERY_RUNTIME_DIST;
assert.ok(runtimeDist, "HSE_EMAIL_DELIVERY_RUNTIME_DIST must be configured");

const auditDomain = require(resolve(runtimeDist, "audit", "audit-domain.js"));
const outboxDomain = require(resolve(runtimeDist, "outbox", "outbox-domain.js"));
const { DatabaseOutboxRepository } = require(
  resolve(runtimeDist, "outbox", "outbox-repository.js")
);
const { DatabaseEmailDeliveryRepository } = require(
  resolve(runtimeDist, "email-delivery", "email-delivery-repository.js")
);
const { LocalTestEmailDeliveryAdapter } = require(
  resolve(runtimeDist, "email-delivery", "email-delivery-adapter.js")
);
const { processEmailDeliveryOutboxJob } = require(
  resolve(runtimeDist, "email-delivery", "email-delivery-handler.js")
);

const BASE_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "email-delivery-runtime-test",
  sessionSecret: "email-runtime-session-secret-with-at-least-32-characters",
  authPepper: "email-runtime-auth-pepper-with-at-least-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function environment(overrides = {}) {
  return { ...BASE_ENVIRONMENT, ...overrides };
}

async function seedWorker(database, suffix) {
  const now = "2026-08-09T09:00:00.000Z";
  const accountId = `account_email_runtime_${suffix}`;
  const email = `email-runtime-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Email Runtime ${suffix}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, now]
  );
  return {
    accountId,
    email,
    principal: {
      sessionId: `session_email_runtime_${suffix}`,
      accountId,
      activeRole: "worker",
      accountStatus: "active",
      email,
      displayName: `Email Runtime ${suffix}`,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: "2099-01-01T00:00:00.000Z",
      tenantMembership: null
    }
  };
}

function repositories(database) {
  return {
    outbox: new DatabaseOutboxRepository(Promise.resolve(database)),
    email: new DatabaseEmailDeliveryRepository(Promise.resolve(database))
  };
}

async function queueFoundationDelivery(database, repos, suffix, fixtureRef) {
  const worker = await seedWorker(database, suffix);
  const actor = auditDomain.bindTrustedAuditActor(worker.principal);
  return database.transaction(async (transaction) => {
    const job = await repos.outbox.enqueueInTransaction(transaction, actor, {
      jobType: "email.delivery.foundation",
      businessKey: `email-runtime-${suffix}`,
      payload: { fixtureRef }
    });
    const first = await repos.email.queueInTransaction(transaction, job);
    const duplicate = await repos.email.queueInTransaction(transaction, job);
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.delivery.deliveryId, first.delivery.deliveryId);
    return { ...worker, job, delivery: first.delivery };
  });
}

async function claim(repos) {
  const worker = outboxDomain.createTrustedOutboxWorker();
  const claimed = await repos.outbox.claimNext(worker);
  assert.ok(claimed, "expected an email outbox job to be claimable");
  assert.equal(claimed.job.jobType, "email.delivery.foundation");
  return claimed;
}

async function makeRetryImmediately(database, jobId) {
  await database.query(
    `UPDATE platform_outbox_jobs
     SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
     WHERE job_id = $1 AND status = 'retry_wait'`,
    [jobId]
  );
}

async function deliveryRow(database, jobId) {
  const result = await database.query(
    `SELECT * FROM platform_email_deliveries WHERE source_job_id = $1`,
    [jobId]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function attemptRows(database, deliveryId) {
  const result = await database.query(
    `SELECT *
     FROM platform_email_delivery_attempts
     WHERE delivery_id = $1
     ORDER BY attempt_number`,
    [deliveryId]
  );
  return result.rows;
}

async function emailAuditActions(database, deliveryId) {
  const result = await database.query(
    `SELECT action_key
     FROM platform_audit_events
     WHERE target_type = 'email_delivery'
       AND target_reference = $1
     ORDER BY audit_sequence`,
    [deliveryId]
  );
  return result.rows.map((row) => row.action_key);
}

async function assertNoRecipientLeak(database, jobId, deliveryId, email) {
  const outbox = await database.query(
    `SELECT payload, last_error_code, last_error_summary
     FROM platform_outbox_jobs WHERE job_id = $1`,
    [jobId]
  );
  const delivery = await database.query(
    `SELECT delivery_key, recipient_address_hash, last_result_code,
            last_result_summary
     FROM platform_email_deliveries WHERE delivery_id = $1`,
    [deliveryId]
  );
  const attempts = await database.query(
    `SELECT dispatch_key, result_code, result_summary,
            provider_reference_hash
     FROM platform_email_delivery_attempts WHERE delivery_id = $1`,
    [deliveryId]
  );
  const audit = await database.query(
    `SELECT metadata
     FROM platform_audit_events
     WHERE target_reference IN ($1, $2)`,
    [jobId, deliveryId]
  );
  const persisted = JSON.stringify({
    outbox: outbox.rows,
    delivery: delivery.rows,
    attempts: attempts.rows,
    audit: audit.rows
  }).toLowerCase();
  assert.equal(persisted.includes(email.toLowerCase()), false);
}

test("real local adapter delivers once and a reclaimed outbox lease does not redispatch", async () => {
  const env = environment({ releaseSha: "email-runtime-reclaim" });
  const database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const repos = repositories(database);
    const queued = await queueFoundationDelivery(
      database,
      repos,
      "reclaim",
      "email.foundation.success.reclaim"
    );
    const localAdapter = new LocalTestEmailDeliveryAdapter("test");
    let adapterCalls = 0;
    const countingAdapter = {
      key: localAdapter.key,
      async deliver(input) {
        adapterCalls += 1;
        return localAdapter.deliver(input);
      }
    };

    const firstClaim = await claim(repos);
    const firstResult = await processEmailDeliveryOutboxJob(
      firstClaim.job,
      firstClaim.lease,
      { database, repository: repos.email, adapter: countingAdapter }
    );
    assert.deepEqual(firstResult, { kind: "succeeded" });
    assert.equal(adapterCalls, 1);

    const delivered = await deliveryRow(database, queued.job.jobId);
    assert.equal(delivered.status, "delivered");
    assert.equal(Number(delivered.attempt_count), 1);
    assert.ok(delivered.delivered_at);
    assert.equal((await attemptRows(database, delivered.delivery_id)).length, 1);

    // Simulate a crash after durable delivery but before central outbox success.
    await database.query(
      `UPDATE platform_outbox_jobs
       SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE job_id = $1 AND status = 'leased'`,
      [queued.job.jobId]
    );
    const reclaimed = await claim(repos);
    assert.equal(reclaimed.lease.attemptNumber, 2);
    const reclaimedResult = await processEmailDeliveryOutboxJob(
      reclaimed.job,
      reclaimed.lease,
      { database, repository: repos.email, adapter: countingAdapter }
    );
    assert.deepEqual(reclaimedResult, { kind: "succeeded" });
    assert.equal(adapterCalls, 1, "durably delivered email must not dispatch twice");
    assert.equal((await attemptRows(database, delivered.delivery_id)).length, 1);

    const completed = await repos.outbox.succeed(reclaimed.lease);
    assert.equal(completed.status, "succeeded");
    assert.deepEqual(
      await emailAuditActions(database, delivered.delivery_id),
      ["email.delivery.attempt.started", "email.delivery.delivered"]
    );
    await assertNoRecipientLeak(
      database,
      queued.job.jobId,
      delivered.delivery_id,
      queued.email
    );
  } finally {
    await database.close();
  }
});

test("real local adapter retries once and then delivers with durable attempt history", async () => {
  const env = environment({ releaseSha: "email-runtime-retry" });
  const database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const repos = repositories(database);
    const queued = await queueFoundationDelivery(
      database,
      repos,
      "retry",
      "email.foundation.retry_once.retry"
    );
    const adapter = new LocalTestEmailDeliveryAdapter("test");

    const firstClaim = await claim(repos);
    const firstResult = await processEmailDeliveryOutboxJob(
      firstClaim.job,
      firstClaim.lease,
      { database, repository: repos.email, adapter }
    );
    assert.equal(firstResult.kind, "retryable");
    const retryJob = await repos.outbox.retry(
      firstClaim.lease,
      firstResult.failure
    );
    assert.equal(retryJob.status, "retry_wait");
    await makeRetryImmediately(database, queued.job.jobId);

    const secondClaim = await claim(repos);
    assert.equal(secondClaim.lease.attemptNumber, 2);
    const secondResult = await processEmailDeliveryOutboxJob(
      secondClaim.job,
      secondClaim.lease,
      { database, repository: repos.email, adapter }
    );
    assert.deepEqual(secondResult, { kind: "succeeded" });
    await repos.outbox.succeed(secondClaim.lease);

    const delivered = await deliveryRow(database, queued.job.jobId);
    assert.equal(delivered.status, "delivered");
    assert.equal(Number(delivered.attempt_count), 2);
    const attempts = await attemptRows(database, delivered.delivery_id);
    assert.deepEqual(
      attempts.map((attempt) => attempt.outcome),
      ["retryable_failure", "delivered"]
    );
    assert.notEqual(attempts[0].dispatch_key, attempts[1].dispatch_key);
    assert.deepEqual(
      await emailAuditActions(database, delivered.delivery_id),
      [
        "email.delivery.attempt.started",
        "email.delivery.retry_scheduled",
        "email.delivery.attempt.started",
        "email.delivery.delivered"
      ]
    );
    await assertNoRecipientLeak(
      database,
      queued.job.jobId,
      delivered.delivery_id,
      queued.email
    );
  } finally {
    await database.close();
  }
});

test("fifth retryable local adapter attempt becomes durable terminal failure", async () => {
  const env = environment({ releaseSha: "email-runtime-terminal-five" });
  const database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const repos = repositories(database);
    const queued = await queueFoundationDelivery(
      database,
      repos,
      "terminalfive",
      "email.foundation.retry_always.terminalfive"
    );
    const adapter = new LocalTestEmailDeliveryAdapter("test");

    for (let attemptNumber = 1; attemptNumber <= 5; attemptNumber += 1) {
      const claimed = await claim(repos);
      assert.equal(claimed.lease.attemptNumber, attemptNumber);
      const result = await processEmailDeliveryOutboxJob(
        claimed.job,
        claimed.lease,
        { database, repository: repos.email, adapter }
      );
      if (attemptNumber < 5) {
        assert.equal(result.kind, "retryable");
        const retried = await repos.outbox.retry(claimed.lease, result.failure);
        assert.equal(retried.status, "retry_wait");
        await makeRetryImmediately(database, queued.job.jobId);
      } else {
        assert.equal(result.kind, "terminal");
        const terminal = await repos.outbox.terminalFail(
          claimed.lease,
          result.failure
        );
        assert.equal(terminal.status, "terminal_failed");
      }
    }

    const failed = await deliveryRow(database, queued.job.jobId);
    assert.equal(failed.status, "terminal_failed");
    assert.equal(Number(failed.attempt_count), 5);
    assert.ok(failed.terminal_failed_at);
    const attempts = await attemptRows(database, failed.delivery_id);
    assert.deepEqual(
      attempts.map((attempt) => attempt.outcome),
      [
        "retryable_failure",
        "retryable_failure",
        "retryable_failure",
        "retryable_failure",
        "terminal_failure"
      ]
    );
    const actions = await emailAuditActions(database, failed.delivery_id);
    assert.equal(
      actions.filter((action) => action === "email.delivery.attempt.started").length,
      5
    );
    assert.equal(
      actions.filter((action) => action === "email.delivery.retry_scheduled").length,
      4
    );
    assert.equal(
      actions.filter((action) => action === "email.delivery.terminal_failed").length,
      1
    );
    await assertNoRecipientLeak(
      database,
      queued.job.jobId,
      failed.delivery_id,
      queued.email
    );
  } finally {
    await database.close();
  }
});

test("delivered email and attempt history survive persistent PGlite close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-email-runtime-"));
  const env = environment({
    pgliteDataDir: directory,
    releaseSha: "email-runtime-persistence"
  });
  let database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const repos = repositories(database);
    const queued = await queueFoundationDelivery(
      database,
      repos,
      "persistent",
      "email.foundation.success.persistent"
    );
    const adapter = new LocalTestEmailDeliveryAdapter("test");
    const claimed = await claim(repos);
    const result = await processEmailDeliveryOutboxJob(
      claimed.job,
      claimed.lease,
      { database, repository: repos.email, adapter }
    );
    assert.deepEqual(result, { kind: "succeeded" });
    await repos.outbox.succeed(claimed.lease);
    const beforeClose = await deliveryRow(database, queued.job.jobId);
    const deliveryId = beforeClose.delivery_id;
    assert.equal(beforeClose.status, "delivered");
    assert.equal((await attemptRows(database, deliveryId)).length, 1);

    await database.close();
    database = null;

    const reopened = await openScriptDatabase(env);
    try {
      const afterReopen = await deliveryRow(reopened, queued.job.jobId);
      assert.equal(afterReopen.delivery_id, deliveryId);
      assert.equal(afterReopen.status, "delivered");
      assert.ok(afterReopen.delivered_at);
      const attempts = await attemptRows(reopened, deliveryId);
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].outcome, "delivered");
      assert.ok(attempts[0].provider_reference_hash);
      assert.deepEqual(
        await emailAuditActions(reopened, deliveryId),
        ["email.delivery.attempt.started", "email.delivery.delivered"]
      );
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
});
