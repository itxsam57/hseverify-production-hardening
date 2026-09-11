import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  migrationStatus
} from "../../scripts/lib/migrations.mjs";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "outbox-foundation-test",
  sessionSecret: "outbox-foundation-session-secret-32-characters",
  authPepper: "outbox-foundation-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function opaqueId(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
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
    resolve("src/lib/outbox/outbox-repository.ts"),
    "utf8"
  );
  return {
    enqueue: extractSql(source, "OUTBOX_ENQUEUE_SQL"),
    deduplicated: extractSql(source, "OUTBOX_FIND_DEDUPLICATED_SQL"),
    lease: extractSql(source, "OUTBOX_LEASE_JOB_SQL"),
    insertAttempt: extractSql(source, "OUTBOX_INSERT_ATTEMPT_SQL"),
    retryJob: extractSql(source, "OUTBOX_RETRY_JOB_SQL"),
    retryAttempt: extractSql(source, "OUTBOX_RETRY_ATTEMPT_SQL"),
    succeedJob: extractSql(source, "OUTBOX_SUCCEED_JOB_SQL"),
    succeedAttempt: extractSql(source, "OUTBOX_SUCCEED_ATTEMPT_SQL"),
    tenantList: extractSql(source, "OUTBOX_TENANT_LIST_SQL"),
    tenantFind: extractSql(source, "OUTBOX_TENANT_FIND_SQL")
  };
}

async function enqueue(database, sql, character, overrides = {}) {
  return database.query(sql, [
    overrides.jobId ?? opaqueId("job", character),
    "platform.foundation.noop",
    1,
    overrides.idempotencyKey ?? character.toLowerCase().repeat(64),
    JSON.stringify({ probeRef: `probe_${character}` }),
    overrides.accountId ?? `account_outbox_${character}`,
    overrides.role ?? "worker",
    overrides.tenantId ?? null,
    overrides.membershipId ?? null
  ]);
}

test("outbox migration creates durable deduplicated history and lifecycle audit vocabulary", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    const applied = await applyPendingMigrations(
      database,
      ENVIRONMENT.releaseSha
    );
    assert.equal(applied.includes("0008_transactional_outbox_jobs"), true);
    const status = await migrationStatus(database);
    const outboxMigration = status.find(
      (entry) => entry.id === "0008_transactional_outbox_jobs"
    );
    assert.equal(outboxMigration?.applied, true);
    assert.equal(outboxMigration?.checksumMatches, true);

    const first = await enqueue(database, sql.enqueue, "A");
    const duplicate = await enqueue(database, sql.enqueue, "A");
    assert.equal(first.rows.length, 1);
    assert.equal(duplicate.rows.length, 0);

    const stored = await database.query(
      "SELECT * FROM platform_outbox_jobs WHERE job_type = $1 AND idempotency_key = $2",
      ["platform.foundation.noop", "a".repeat(64)]
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].status, "pending");
    assert.equal(Number(stored.rows[0].attempt_count), 0);

    await database.query(
      `INSERT INTO platform_audit_events (
         audit_event_id, source_kind, action_key, outcome,
         target_type, target_reference, metadata
       ) VALUES ($1, 'native', 'outbox.job.enqueued', 'succeeded',
         'job', $2, $3::jsonb)`,
      [opaqueId("audit", "A"), first.rows[0].job_id, JSON.stringify({ safe: true })]
    );
    const audit = await database.query(
      "SELECT action_key, target_type FROM platform_audit_events WHERE audit_event_id = $1",
      [opaqueId("audit", "A")]
    );
    assert.deepEqual(audit.rows[0], {
      action_key: "outbox.job.enqueued",
      target_type: "job"
    });

    await assert.rejects(
      database.query(
        "DELETE FROM platform_outbox_jobs WHERE job_id = $1",
        [first.rows[0].job_id]
      ),
      /cannot be deleted/
    );
  } finally {
    await database.close();
  }
});

test("state, outbox work and audit facts roll back and commit as one transaction", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "outbox-atomicity-test"
  });
  try {
    await applyPendingMigrations(database, "outbox-atomicity-test");
    await database.execute(
      "CREATE TABLE outbox_atomic_state (state_id TEXT PRIMARY KEY, value TEXT NOT NULL)"
    );

    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.query(
          "INSERT INTO outbox_atomic_state (state_id, value) VALUES ($1, $2)",
          ["state_rollback", "accepted"]
        );
        const job = await enqueue(transaction, sql.enqueue, "B");
        await transaction.query(
          `INSERT INTO platform_audit_events (
             audit_event_id, source_kind, action_key, outcome,
             target_type, target_reference, metadata
           ) VALUES ($1, 'native', 'outbox.job.enqueued', 'succeeded',
             'job', $2, '{}'::jsonb)`,
          [opaqueId("audit", "B"), job.rows[0].job_id]
        );
        throw new Error("force-rollback");
      }),
      /force-rollback/
    );

    const rolledBackState = await database.query(
      "SELECT * FROM outbox_atomic_state WHERE state_id = 'state_rollback'"
    );
    const rolledBackJob = await database.query(
      "SELECT * FROM platform_outbox_jobs WHERE idempotency_key = $1",
      ["b".repeat(64)]
    );
    const rolledBackAudit = await database.query(
      "SELECT * FROM platform_audit_events WHERE audit_event_id = $1",
      [opaqueId("audit", "B")]
    );
    assert.equal(rolledBackState.rows.length, 0);
    assert.equal(rolledBackJob.rows.length, 0);
    assert.equal(rolledBackAudit.rows.length, 0);

    await database.transaction(async (transaction) => {
      await transaction.query(
        "INSERT INTO outbox_atomic_state (state_id, value) VALUES ($1, $2)",
        ["state_commit", "accepted"]
      );
      const job = await enqueue(transaction, sql.enqueue, "C");
      await transaction.query(
        `INSERT INTO platform_audit_events (
           audit_event_id, source_kind, action_key, outcome,
           target_type, target_reference, metadata
         ) VALUES ($1, 'native', 'outbox.job.enqueued', 'succeeded',
           'job', $2, '{}'::jsonb)`,
        [opaqueId("audit", "C"), job.rows[0].job_id]
      );
    });

    assert.equal((await database.query(
      "SELECT * FROM outbox_atomic_state WHERE state_id = 'state_commit'"
    )).rows.length, 1);
    assert.equal((await database.query(
      "SELECT * FROM platform_outbox_jobs WHERE idempotency_key = $1",
      ["c".repeat(64)]
    )).rows.length, 1);
    assert.equal((await database.query(
      "SELECT * FROM platform_audit_events WHERE audit_event_id = $1",
      [opaqueId("audit", "C")]
    )).rows.length, 1);
  } finally {
    await database.close();
  }
});

test("retry then success preserves attempts and rejects stale completion", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "outbox-lifecycle-test"
  });
  try {
    await applyPendingMigrations(database, "outbox-lifecycle-test");
    const inserted = await enqueue(database, sql.enqueue, "D");
    const jobId = inserted.rows[0].job_id;

    const leaseOne = opaqueId("lease", "D");
    const attemptOne = opaqueId("attempt", "D");
    const workerOne = opaqueId("outbox_worker", "D");
    const firstLease = await database.query(sql.lease, [jobId, leaseOne, workerOne, 60]);
    assert.equal(firstLease.rows[0].status, "leased");
    await database.query(sql.insertAttempt, [attemptOne, jobId, 1, workerOne, leaseOne]);
    const retry = await database.query(sql.retryJob, [
      jobId, leaseOne, workerOne, 5,
      "temporary_failure", "The fixed handler requested a retry."
    ]);
    assert.equal(retry.rows[0].status, "retry_wait");
    await database.query(sql.retryAttempt, [
      attemptOne, jobId, leaseOne, 5,
      "temporary_failure", "The fixed handler requested a retry."
    ]);

    await database.query(
      "UPDATE platform_outbox_jobs SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE job_id = $1",
      [jobId]
    );
    const leaseTwo = opaqueId("lease", "E");
    const attemptTwo = opaqueId("attempt", "E");
    const workerTwo = opaqueId("outbox_worker", "E");
    const secondLease = await database.query(sql.lease, [jobId, leaseTwo, workerTwo, 60]);
    assert.equal(Number(secondLease.rows[0].attempt_count), 2);
    await database.query(sql.insertAttempt, [attemptTwo, jobId, 2, workerTwo, leaseTwo]);

    const stale = await database.query(sql.succeedJob, [jobId, leaseOne, workerOne]);
    assert.equal(stale.rows.length, 0);

    const succeeded = await database.query(sql.succeedJob, [jobId, leaseTwo, workerTwo]);
    assert.equal(succeeded.rows[0].status, "succeeded");
    await database.query(sql.succeedAttempt, [attemptTwo, jobId, leaseTwo, workerTwo]);

    const attempts = await database.query(
      `SELECT attempt_number, outcome
       FROM platform_outbox_job_attempts
       WHERE job_id = $1
       ORDER BY attempt_number`,
      [jobId]
    );
    assert.deepEqual(
      attempts.rows.map((row) => [Number(row.attempt_number), row.outcome]),
      [[1, "retry_scheduled"], [2, "succeeded"]]
    );

    assert.match(sql.tenantList, /WHERE tenant_id = \$1/);
    assert.match(sql.tenantFind, /WHERE tenant_id = \$1[\s\S]*job_id = \$2/);
  } finally {
    await database.close();
  }
});
