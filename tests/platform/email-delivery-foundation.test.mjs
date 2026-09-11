import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations
} from "../../scripts/lib/migrations.mjs";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "email-delivery-foundation-test",
  sessionSecret: "email-delivery-foundation-session-secret-32-characters",
  authPepper: "email-delivery-foundation-auth-pepper-32-characters",
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
  const source = await readFile(
    resolve("src/lib/email-delivery/email-delivery-repository.ts"),
    "utf8"
  );
  return {
    queue: extractSql(source, "EMAIL_QUEUE_SQL"),
    findJob: extractSql(source, "EMAIL_FIND_BY_JOB_SQL"),
    reconcileAttempts: extractSql(source, "EMAIL_RECONCILE_EXPIRED_ATTEMPTS_SQL"),
    reconcileDelivery: extractSql(source, "EMAIL_RECONCILE_DELIVERY_SQL"),
    insertAttempt: extractSql(source, "EMAIL_INSERT_ATTEMPT_SQL"),
    markProcessing: extractSql(source, "EMAIL_MARK_PROCESSING_SQL"),
    finalizeAttempt: extractSql(source, "EMAIL_FINALIZE_ATTEMPT_SQL"),
    finalizeDelivery: extractSql(source, "EMAIL_FINALIZE_DELIVERY_SQL"),
    list: extractSql(source, "EMAIL_LIST_SQL"),
    findScoped: extractSql(source, "EMAIL_FIND_SCOPED_SQL"),
    attemptsScoped: extractSql(source, "EMAIL_ATTEMPTS_SCOPED_SQL")
  };
}

async function insertActiveAccount(database, suffix, role) {
  const accountId = `account_email_${suffix}`;
  const now = "2026-08-09T08:00:00.000Z";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `${suffix}@example.com`, `Email ${suffix}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, $3)`,
    [accountId, role, now]
  );
  return { accountId, now };
}

async function insertCompanyScope(database, accountId, suffix, now) {
  const tenantId = opaque("tenant", suffix);
  const membershipId = opaque("membership", suffix);
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `Email Tenant ${suffix}`, accountId, now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, now]
  );
  return { tenantId, membershipId };
}

async function insertEmailJob(database, input) {
  const jobId = opaque("job", input.character);
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'email.delivery.foundation', 1, $2, $3::jsonb, $4, $5, $6, $7)`,
    [
      jobId,
      hash(input.character),
      JSON.stringify({ fixtureRef: `email.foundation.success.${input.character}` }),
      input.accountId,
      input.role,
      input.tenantId ?? null,
      input.membershipId ?? null
    ]
  );
  return jobId;
}

async function queueDelivery(database, sql, input) {
  return database.query(sql, [
    opaque("email_delivery", input.character),
    1,
    input.jobId,
    hash(input.deliveryKeyCharacter ?? input.character),
    input.accountId,
    input.role,
    input.tenantId ?? null,
    input.membershipId ?? null,
    hash(input.addressHashCharacter ?? "f")
  ]);
}

async function leaseJob(database, input) {
  const attemptId = opaque("attempt", input.character);
  const workerId = opaque("outbox_worker", input.workerCharacter ?? "W");
  const leaseId = opaque("lease", input.leaseCharacter ?? "L");
  await database.query(
    `UPDATE platform_outbox_jobs
     SET status = 'leased',
         attempt_count = $2,
         lease_id = $3,
         worker_id = $4,
         lease_expires_at = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE job_id = $1`,
    [
      input.jobId,
      input.attemptNumber,
      leaseId,
      workerId,
      input.expiresAt ?? "2099-01-01T00:00:00.000Z"
    ]
  );
  await database.query(
    `INSERT INTO platform_outbox_job_attempts (
       attempt_id, job_id, attempt_number, worker_id, lease_id, outcome
     ) VALUES ($1, $2, $3, $4, $5, 'running')`,
    [attemptId, input.jobId, input.attemptNumber, workerId, leaseId]
  );
  return { attemptId, workerId, leaseId };
}

async function expireOutboxAttempt(database, attemptId) {
  await database.query(
    `UPDATE platform_outbox_job_attempts
     SET outcome = 'lease_expired',
         error_code = 'lease_expired',
         error_summary = 'The outbox worker lease expired before completion.',
         finished_at = CURRENT_TIMESTAMP
     WHERE attempt_id = $1
       AND outcome = 'running'`,
    [attemptId]
  );
}

test("email delivery is queued durably and completes only under the exact active outbox lease", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    const manifest = (await listMigrations()).map((migration) => migration.id);
    const applied = await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    assert.deepEqual(applied, manifest);
    const emailIndex = manifest.indexOf("0010_email_delivery_foundation");
    assert.ok(emailIndex >= 0, "email delivery migration must remain registered");
    assert.equal(manifest[emailIndex - 1], "0009_persisted_notifications");

    const worker = await insertActiveAccount(database, "worker", "worker");
    const jobId = await insertEmailJob(database, {
      character: "A",
      accountId: worker.accountId,
      role: "worker"
    });
    const queued = await queueDelivery(database, sql.queue, {
      character: "A",
      jobId,
      accountId: worker.accountId,
      role: "worker"
    });
    assert.equal(queued.rows.length, 1);
    assert.equal(queued.rows[0].status, "queued");
    assert.equal(queued.rows[0].attempt_count, 0);
    assert.equal("recipient_address" in queued.rows[0], false);
    assert.match(queued.rows[0].recipient_address_hash, /^[a-f0-9]{64}$/);

    const lease = await leaseJob(database, {
      character: "B",
      jobId,
      attemptNumber: 1
    });
    const insertedAttempt = await database.query(sql.insertAttempt, [
      opaque("email_attempt", "B"),
      jobId,
      lease.attemptId,
      1,
      lease.workerId,
      lease.leaseId,
      "local_test",
      hash("d")
    ]);
    assert.equal(insertedAttempt.rows.length, 1);
    assert.equal(insertedAttempt.rows[0].outcome, "running");

    const processing = await database.query(sql.markProcessing, [
      queued.rows[0].delivery_id,
      1
    ]);
    assert.equal(processing.rows[0].status, "processing");
    assert.equal(processing.rows[0].attempt_count, 1);

    const finalizedAttempt = await database.query(sql.finalizeAttempt, [
      lease.attemptId,
      jobId,
      lease.workerId,
      lease.leaseId,
      "delivered",
      "local_accepted",
      "The local test adapter accepted the delivery.",
      hash("p")
    ]);
    assert.equal(finalizedAttempt.rows[0].outcome, "delivered");
    assert.ok(finalizedAttempt.rows[0].finished_at);

    const delivered = await database.query(sql.finalizeDelivery, [
      queued.rows[0].delivery_id,
      "delivered",
      1,
      "local_accepted",
      "The local test adapter accepted the delivery."
    ]);
    assert.equal(delivered.rows[0].status, "delivered");
    assert.ok(delivered.rows[0].delivered_at);
    assert.equal(delivered.rows[0].terminal_failed_at, null);

    const duplicateStart = await database.query(sql.insertAttempt, [
      opaque("email_attempt", "Q"),
      jobId,
      lease.attemptId,
      1,
      lease.workerId,
      lease.leaseId,
      "local_test",
      hash("d")
    ]);
    assert.equal(duplicateStart.rows.length, 0);

    await expireOutboxAttempt(database, lease.attemptId);
    const postDeliveryLease = await leaseJob(database, {
      character: "R",
      jobId,
      attemptNumber: 2,
      workerCharacter: "Y",
      leaseCharacter: "Z"
    });
    const postDeliveryAttempt = await database.query(sql.insertAttempt, [
      opaque("email_attempt", "R"),
      jobId,
      postDeliveryLease.attemptId,
      2,
      postDeliveryLease.workerId,
      postDeliveryLease.leaseId,
      "local_test",
      hash("r")
    ]);
    assert.equal(postDeliveryAttempt.rows.length, 0);
    const attemptCount = await database.query(
      `SELECT COUNT(*)::int AS count
       FROM platform_email_delivery_attempts
       WHERE delivery_id = $1`,
      [queued.rows[0].delivery_id]
    );
    assert.equal(Number(attemptCount.rows[0].count), 1);

    await assert.rejects(
      database.query(
        `UPDATE platform_email_deliveries
         SET recipient_address_hash = $2
         WHERE delivery_id = $1`,
        [queued.rows[0].delivery_id, hash("z")]
      ),
      /identity and trusted scope are immutable/
    );
    await assert.rejects(
      database.query(
        `DELETE FROM platform_email_delivery_attempts
         WHERE email_attempt_id = $1`,
        [insertedAttempt.rows[0].email_attempt_id]
      ),
      /attempt history cannot be deleted/
    );
    await assert.rejects(
      database.query(
        `DELETE FROM platform_email_deliveries WHERE delivery_id = $1`,
        [queued.rows[0].delivery_id]
      ),
      /delivery history cannot be deleted/
    );
  } finally {
    await database.close();
  }
});

test("stale email leases are filtered and a reclaimed worker alone can continue delivery", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "email-stale-lease-test"
  });
  try {
    await applyPendingMigrations(database, "email-stale-lease-test");
    const worker = await insertActiveAccount(database, "stale", "worker");

    const staleStartJobId = await insertEmailJob(database, {
      character: "C",
      accountId: worker.accountId,
      role: "worker"
    });
    await queueDelivery(database, sql.queue, {
      character: "C",
      jobId: staleStartJobId,
      accountId: worker.accountId,
      role: "worker"
    });
    const expiredBeforeStart = await leaseJob(database, {
      character: "D",
      jobId: staleStartJobId,
      attemptNumber: 1,
      expiresAt: "2000-01-01T00:00:00.000Z"
    });
    const staleInsert = await database.query(sql.insertAttempt, [
      opaque("email_attempt", "D"),
      staleStartJobId,
      expiredBeforeStart.attemptId,
      1,
      expiredBeforeStart.workerId,
      expiredBeforeStart.leaseId,
      "local_test",
      hash("e")
    ]);
    assert.equal(staleInsert.rows.length, 0);

    const reclaimJobId = await insertEmailJob(database, {
      character: "E",
      accountId: worker.accountId,
      role: "worker"
    });
    const queued = await queueDelivery(database, sql.queue, {
      character: "E",
      jobId: reclaimJobId,
      accountId: worker.accountId,
      role: "worker",
      addressHashCharacter: "e"
    });
    const firstLease = await leaseJob(database, {
      character: "F",
      jobId: reclaimJobId,
      attemptNumber: 1,
      workerCharacter: "U",
      leaseCharacter: "N"
    });
    const firstAttempt = await database.query(sql.insertAttempt, [
      opaque("email_attempt", "F"),
      reclaimJobId,
      firstLease.attemptId,
      1,
      firstLease.workerId,
      firstLease.leaseId,
      "local_test",
      hash("f")
    ]);
    assert.equal(firstAttempt.rows.length, 1);
    const firstProcessing = await database.query(sql.markProcessing, [
      queued.rows[0].delivery_id,
      1
    ]);
    assert.equal(firstProcessing.rows[0].attempt_count, 1);

    await database.query(
      `UPDATE platform_outbox_jobs
       SET lease_expires_at = $2
       WHERE job_id = $1`,
      [reclaimJobId, "2000-01-01T00:00:00.000Z"]
    );
    await expireOutboxAttempt(database, firstLease.attemptId);

    const reconciledAttempts = await database.query(sql.reconcileAttempts, [
      queued.rows[0].delivery_id
    ]);
    assert.equal(reconciledAttempts.rows.length, 1);
    assert.equal(reconciledAttempts.rows[0].outcome, "lease_expired");
    const reconciledDelivery = await database.query(sql.reconcileDelivery, [
      queued.rows[0].delivery_id
    ]);
    assert.equal(reconciledDelivery.rows[0].status, "retry_wait");
    assert.equal(reconciledDelivery.rows[0].attempt_count, 1);

    const currentLease = await leaseJob(database, {
      character: "G",
      jobId: reclaimJobId,
      attemptNumber: 2,
      leaseCharacter: "M",
      workerCharacter: "X"
    });
    const currentAttempt = await database.query(sql.insertAttempt, [
      opaque("email_attempt", "G"),
      reclaimJobId,
      currentLease.attemptId,
      2,
      currentLease.workerId,
      currentLease.leaseId,
      "local_test",
      hash("g")
    ]);
    assert.equal(currentAttempt.rows.length, 1);
    const processing = await database.query(sql.markProcessing, [
      queued.rows[0].delivery_id,
      2
    ]);
    assert.equal(processing.rows[0].attempt_count, 2);

    const staleFinalize = await database.query(sql.finalizeAttempt, [
      firstLease.attemptId,
      reclaimJobId,
      firstLease.workerId,
      firstLease.leaseId,
      "delivered",
      "local_accepted",
      "The local test adapter accepted the delivery.",
      hash("h")
    ]);
    assert.equal(staleFinalize.rows.length, 0);

    const currentFinalize = await database.query(sql.finalizeAttempt, [
      currentLease.attemptId,
      reclaimJobId,
      currentLease.workerId,
      currentLease.leaseId,
      "retryable_failure",
      "local_temporary_unavailable",
      "The local test adapter requested one deterministic retry.",
      null
    ]);
    assert.equal(currentFinalize.rows.length, 1);
    const retry = await database.query(sql.finalizeDelivery, [
      queued.rows[0].delivery_id,
      "retry_wait",
      2,
      "local_temporary_unavailable",
      "The local test adapter requested one deterministic retry."
    ]);
    assert.equal(retry.rows[0].status, "retry_wait");
  } finally {
    await database.close();
  }
});

test("email delivery reads are direct recipient and Company tenant boundaries", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "email-scope-test"
  });
  try {
    await applyPendingMigrations(database, "email-scope-test");
    const companyA = await insertActiveAccount(database, "companya", "company");
    const companyB = await insertActiveAccount(database, "companyb", "company");
    const scopeA = await insertCompanyScope(
      database,
      companyA.accountId,
      "A",
      companyA.now
    );
    const scopeB = await insertCompanyScope(
      database,
      companyB.accountId,
      "B",
      companyB.now
    );
    const jobA = await insertEmailJob(database, {
      character: "H",
      accountId: companyA.accountId,
      role: "company",
      ...scopeA
    });
    const jobB = await insertEmailJob(database, {
      character: "I",
      accountId: companyB.accountId,
      role: "company",
      ...scopeB
    });
    const deliveryA = await queueDelivery(database, sql.queue, {
      character: "H",
      jobId: jobA,
      accountId: companyA.accountId,
      role: "company",
      ...scopeA
    });
    const deliveryB = await queueDelivery(database, sql.queue, {
      character: "I",
      jobId: jobB,
      accountId: companyB.accountId,
      role: "company",
      ...scopeB,
      addressHashCharacter: "e"
    });

    const listA = await database.query(sql.list, [
      companyA.accountId,
      "company",
      scopeA.tenantId,
      scopeA.membershipId,
      null,
      50
    ]);
    assert.deepEqual(listA.rows.map((row) => row.delivery_id), [
      deliveryA.rows[0].delivery_id
    ]);

    const crossTenant = await database.query(sql.findScoped, [
      deliveryB.rows[0].delivery_id,
      companyA.accountId,
      "company",
      scopeA.tenantId,
      scopeA.membershipId
    ]);
    assert.equal(crossTenant.rows.length, 0);

    const wrongRole = await database.query(sql.findScoped, [
      deliveryA.rows[0].delivery_id,
      companyA.accountId,
      "worker",
      null,
      null
    ]);
    assert.equal(wrongRole.rows.length, 0);
  } finally {
    await database.close();
  }
});

test("email delivery queue rejects a source scope mismatch and an unverified recipient", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "email-recipient-guard-test"
  });
  try {
    await applyPendingMigrations(database, "email-recipient-guard-test");
    const first = await insertActiveAccount(database, "first", "worker");
    const second = await insertActiveAccount(database, "second", "worker");
    const jobId = await insertEmailJob(database, {
      character: "J",
      accountId: first.accountId,
      role: "worker"
    });
    await assert.rejects(
      queueDelivery(database, sql.queue, {
        character: "J",
        jobId,
        accountId: second.accountId,
        role: "worker"
      }),
      /recipient scope must match its trusted source job/
    );

    await database.query(
      `UPDATE auth_accounts
       SET account_status = 'pending_email', email_verified_at = NULL
       WHERE account_id = $1`,
      [first.accountId]
    );
    await assert.rejects(
      queueDelivery(database, sql.queue, {
        character: "K",
        jobId,
        accountId: first.accountId,
        role: "worker",
        deliveryKeyCharacter: "k"
      }),
      /active account with a verified email/
    );
  } finally {
    await database.close();
  }
});