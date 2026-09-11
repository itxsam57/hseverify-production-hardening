import assert from "node:assert/strict";
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
  releaseSha: "outbox-concurrency-test",
  sessionSecret: "outbox-concurrency-session-secret-32-characters",
  authPepper: "outbox-concurrency-auth-pepper-32-characters",
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
    candidate: extractSql(source, "OUTBOX_CLAIM_CANDIDATE_SQL"),
    expiredAttempt: extractSql(source, "OUTBOX_MARK_EXPIRED_ATTEMPT_SQL"),
    lease: extractSql(source, "OUTBOX_LEASE_JOB_SQL"),
    attempt: extractSql(source, "OUTBOX_INSERT_ATTEMPT_SQL"),
    succeedJob: extractSql(source, "OUTBOX_SUCCEED_JOB_SQL"),
    succeedAttempt: extractSql(source, "OUTBOX_SUCCEED_ATTEMPT_SQL"),
    terminalJob: extractSql(source, "OUTBOX_TERMINAL_JOB_SQL"),
    terminalAttempt: extractSql(source, "OUTBOX_TERMINAL_ATTEMPT_SQL")
  };
}

async function enqueue(database, sql, index) {
  const character = String.fromCharCode(65 + index);
  const result = await database.query(sql, [
    opaqueId("job", character),
    "platform.foundation.noop",
    1,
    character.toLowerCase().repeat(64),
    JSON.stringify({ probeRef: `probe_${character}` }),
    `account_${character}`,
    "worker",
    null,
    null
  ]);
  return result.rows[0];
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

    const leaseId = opaqueId("lease", character);
    const workerId = opaqueId("outbox_worker", character);
    const leased = await transaction.query(sql.lease, [
      row.job_id,
      leaseId,
      workerId,
      60
    ]);
    if (!leased.rows[0]) return null;
    const attemptNumber = Number(leased.rows[0].attempt_count);
    const attemptId = opaqueId(
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
      attemptId,
      attemptNumber,
      workerId,
      leaseId
    };
  });
}

test("concurrent workers claim different jobs without duplicate leases", async () => {
  const sql = await contracts();
  assert.match(sql.candidate, /FOR UPDATE SKIP LOCKED/);

  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    for (let index = 0; index < 6; index += 1) {
      await enqueue(database, sql.enqueue, index);
    }

    const claims = (
      await Promise.all(
        ["A", "B", "C", "D"].map((character) =>
          claim(database, sql, character)
        )
      )
    ).filter(Boolean);

    assert.equal(claims.length, 4);
    assert.equal(new Set(claims.map((claim) => claim.jobId)).size, 4);
    assert.equal(new Set(claims.map((claim) => claim.leaseId)).size, 4);

    const stored = await database.query(
      `SELECT job_id, lease_id, worker_id
       FROM platform_outbox_jobs
       WHERE status = 'leased'`
    );
    assert.equal(stored.rows.length, 4);
    assert.equal(new Set(stored.rows.map((row) => row.job_id)).size, 4);
    assert.equal(new Set(stored.rows.map((row) => row.lease_id)).size, 4);
  } finally {
    await database.close();
  }
});

test("expired leases are reclaimable and stale workers cannot complete", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "outbox-lease-expiry-test"
  });
  try {
    await applyPendingMigrations(database, "outbox-lease-expiry-test");
    await enqueue(database, sql.enqueue, 0);

    const first = await claim(database, sql, "A");
    assert.ok(first);
    await database.query(
      `UPDATE platform_outbox_jobs
       SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE job_id = $1`,
      [first.jobId]
    );

    const second = await claim(database, sql, "B");
    assert.ok(second);
    assert.equal(second.jobId, first.jobId);
    assert.equal(second.attemptNumber, 2);
    assert.notEqual(second.leaseId, first.leaseId);

    const oldAttempt = await database.query(
      `SELECT outcome FROM platform_outbox_job_attempts
       WHERE attempt_id = $1`,
      [first.attemptId]
    );
    assert.equal(oldAttempt.rows[0].outcome, "lease_expired");

    const stale = await database.query(sql.succeedJob, [
      first.jobId,
      first.leaseId,
      first.workerId
    ]);
    assert.equal(stale.rows.length, 0);

    const succeeded = await database.query(sql.succeedJob, [
      second.jobId,
      second.leaseId,
      second.workerId
    ]);
    assert.equal(succeeded.rows[0].status, "succeeded");
    await database.query(sql.succeedAttempt, [
      second.attemptId,
      second.jobId,
      second.leaseId,
      second.workerId
    ]);
  } finally {
    await database.close();
  }
});

test("the fifth failed attempt becomes terminal and remains durable", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "outbox-terminal-test"
  });
  try {
    await applyPendingMigrations(database, "outbox-terminal-test");
    const inserted = await enqueue(database, sql.enqueue, 1);
    await database.query(
      `UPDATE platform_outbox_jobs
       SET status = 'retry_wait',
           attempt_count = 4,
           next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE job_id = $1`,
      [inserted.job_id]
    );

    const fifth = await claim(database, sql, "C");
    assert.ok(fifth);
    assert.equal(fifth.attemptNumber, 5);
    const failureCode = "permanent_failure";
    const failureSummary = "The fixed handler rejected the job permanently.";

    const terminal = await database.query(sql.terminalJob, [
      fifth.jobId,
      fifth.leaseId,
      fifth.workerId,
      failureCode,
      failureSummary
    ]);
    assert.equal(terminal.rows[0].status, "terminal_failed");
    await database.query(sql.terminalAttempt, [
      fifth.attemptId,
      fifth.jobId,
      fifth.leaseId,
      fifth.workerId,
      failureCode,
      failureSummary
    ]);

    const retained = await database.query(
      `SELECT status, attempt_count, terminal_failed_at
       FROM platform_outbox_jobs
       WHERE job_id = $1`,
      [fifth.jobId]
    );
    assert.equal(retained.rows[0].status, "terminal_failed");
    assert.equal(Number(retained.rows[0].attempt_count), 5);
    assert.ok(retained.rows[0].terminal_failed_at);

    await assert.rejects(
      database.query(
        "DELETE FROM platform_outbox_job_attempts WHERE job_id = $1",
        [fifth.jobId]
      ),
      /cannot be deleted/
    );
  } finally {
    await database.close();
  }
});
