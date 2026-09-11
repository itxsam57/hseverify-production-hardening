import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_SECURE_SCAN_RUNTIME_DIST;
assert.ok(runtimeDist, "HSE_SECURE_SCAN_RUNTIME_DIST must be configured");

const scanDomain = require(resolve(runtimeDist, "secure-files", "secure-file-scan-domain.js"));
const { DatabaseSecureFileScanRepository } = require(
  resolve(runtimeDist, "secure-files", "secure-file-scan-repository.js")
);
const outboxDomain = require(resolve(runtimeDist, "outbox", "outbox-domain.js"));
const { DatabaseOutboxRepository } = require(
  resolve(runtimeDist, "outbox", "outbox-repository.js")
);

const NOW = "2026-08-09T20:00:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";
const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-scan-runtime",
  sessionSecret: "secure-file-scan-runtime-session-secret-32-chars",
  authPepper: "secure-file-scan-runtime-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

async function seedWorker(database, suffix) {
  const accountId = `account_scan_runtime_${suffix}`;
  const sessionId = `session_scan_runtime_${suffix}`;
  const email = `scan-runtime-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Scan Runtime ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'worker', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, hash(`token:${suffix}`), hash(`csrf:${suffix}`), NOW, EXPIRES]
  );
  return {
    accountId,
    sessionId,
    principal: {
      sessionId,
      accountId,
      activeRole: "worker",
      accountStatus: "active",
      email,
      displayName: `Scan Runtime ${suffix}`,
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: EXPIRES,
      tenantMembership: null
    }
  };
}

async function seedQuarantinedFile(database, worker, marker) {
  const fileRef = `secure_file_${marker.repeat(24)}`;
  const contentSha256 = hash(`content:${marker}`);
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL,
       'local_test', $4, 'scan.pdf')`,
    [
      fileRef,
      hash(`reservation:${marker}`),
      worker.accountId,
      `secure-files/${hash(`object:${marker}`)}`
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined',
         file_extension = 'pdf',
         declared_mime = 'application/pdf',
         detected_mime = 'application/pdf',
         byte_size = 256,
         content_sha256 = $2
     WHERE file_id = $1`,
    [fileRef, contentSha256]
  );
  return { fileRef, contentSha256 };
}

async function secureFile(database, fileRef) {
  const result = await database.query(
    `SELECT lifecycle_status, scan_generation, scan_job_id,
            scan_result_code, scan_completed_at, content_sha256
     FROM platform_secure_files WHERE file_id = $1`,
    [fileRef]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function scanAudits(database, fileRef, action) {
  const result = await database.query(
    `SELECT audit_event_id, action_key, outcome, reason_key,
            actor_account_id, actor_role, actor_tenant_id,
            target_type, target_reference, metadata
     FROM platform_audit_events
     WHERE target_reference = $1 AND action_key = $2
     ORDER BY audit_sequence`,
    [fileRef, action]
  );
  return result.rows;
}

test("real scan scheduler deduplicates generation and terminal outbox failure recovers file for a new generation", async () => {
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const ownerWorker = await seedWorker(database, "owner");
    const attacker = await seedWorker(database, "attacker");
    const seeded = await seedQuarantinedFile(database, ownerWorker, "A");

    const scans = new DatabaseSecureFileScanRepository(Promise.resolve(database));
    const outbox = new DatabaseOutboxRepository(Promise.resolve(database));

    const scheduled = await scans.scheduleForPrincipal({
      principal: ownerWorker.principal,
      fileRef: seeded.fileRef
    });
    assert.equal(scheduled.created, true);
    assert.equal(scheduled.generation, 1);
    assert.match(scheduled.jobId, /^job_[A-Za-z0-9_-]{24}$/);

    const pending = await secureFile(database, seeded.fileRef);
    assert.equal(pending.lifecycle_status, "scan_pending");
    assert.equal(Number(pending.scan_generation), 1);
    assert.equal(pending.scan_job_id, scheduled.jobId);
    assert.equal(pending.scan_result_code, null);
    assert.equal(pending.scan_completed_at, null);
    assert.equal(pending.content_sha256, seeded.contentSha256);

    const jobRows = await database.query(
      `SELECT job_id, job_type, status, payload, idempotency_key,
              enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
       FROM platform_outbox_jobs WHERE job_id = $1`,
      [scheduled.jobId]
    );
    assert.equal(jobRows.rows.length, 1);
    assert.equal(jobRows.rows[0].job_type, "secure_file.scan");
    assert.equal(jobRows.rows[0].status, "pending");
    assert.deepEqual(jobRows.rows[0].payload, {
      fileRef: seeded.fileRef,
      generation: 1
    });
    assert.equal(jobRows.rows[0].enqueued_by_account_id, ownerWorker.accountId);
    assert.equal(jobRows.rows[0].enqueued_by_role, "worker");
    assert.equal(jobRows.rows[0].tenant_id, null);
    assert.equal(jobRows.rows[0].membership_id, null);

    const expectedBusinessKey = scanDomain.deriveSecureFileScanBusinessKey({
      fileRef: seeded.fileRef,
      contentSha256: seeded.contentSha256,
      generation: 1
    });
    assert.equal(
      jobRows.rows[0].idempotency_key,
      outboxDomain.deriveOutboxIdempotencyKey(
        "secure_file.scan",
        expectedBusinessKey,
        `account:${ownerWorker.accountId}`
      )
    );

    const queuedAudits = await scanAudits(database, seeded.fileRef, "secure_file.scan.queued");
    assert.equal(queuedAudits.length, 1);
    assert.equal(queuedAudits[0].actor_account_id, ownerWorker.accountId);
    assert.equal(queuedAudits[0].actor_role, "worker");
    assert.equal(queuedAudits[0].target_type, "secure_file");
    assert.equal(Number(queuedAudits[0].metadata.generation), 1);
    assert.equal(queuedAudits[0].metadata.sourceJobId, scheduled.jobId);

    const replay = await scans.scheduleForPrincipal({
      principal: ownerWorker.principal,
      fileRef: seeded.fileRef
    });
    assert.deepEqual(replay, {
      created: false,
      fileRef: seeded.fileRef,
      generation: 1,
      jobId: scheduled.jobId
    });
    assert.equal(
      Number((await database.query(
        `SELECT COUNT(*) AS count FROM platform_outbox_jobs
         WHERE job_type = 'secure_file.scan'`
      )).rows[0].count),
      1
    );
    assert.equal((await scanAudits(database, seeded.fileRef, "secure_file.scan.queued")).length, 1);

    await assert.rejects(
      scans.scheduleForPrincipal({
        principal: attacker.principal,
        fileRef: seeded.fileRef
      }),
      /scan could not be accessed/i
    );

    const worker = outboxDomain.createTrustedOutboxWorker();
    const claimed = await outbox.claimNext(worker);
    assert.ok(claimed);
    assert.equal(claimed.job.jobId, scheduled.jobId);
    assert.equal(claimed.job.jobType, "secure_file.scan");
    assert.equal(claimed.job.status, "leased");

    const terminal = await outbox.terminalFail(claimed.lease, {
      code: "scanner_terminal_fixture",
      summary: "The deterministic scanner reached a terminal fixture result."
    });
    assert.equal(terminal.status, "terminal_failed");

    const failed = await secureFile(database, seeded.fileRef);
    assert.equal(failed.lifecycle_status, "scan_failed");
    assert.equal(Number(failed.scan_generation), 1);
    assert.equal(failed.scan_job_id, scheduled.jobId);
    assert.equal(failed.scan_result_code, "scanner_terminal_fixture");
    assert.ok(failed.scan_completed_at);

    const failedAudits = await scanAudits(database, seeded.fileRef, "secure_file.scan.failed");
    assert.equal(failedAudits.length, 1);
    assert.equal(failedAudits[0].outcome, "failed");
    assert.equal(failedAudits[0].reason_key, "scanner_terminal_fixture");
    assert.equal(failedAudits[0].actor_account_id, null);
    assert.equal(failedAudits[0].actor_role, null);
    assert.equal(failedAudits[0].metadata.sourceJobId, scheduled.jobId);
    assert.equal(Number(failedAudits[0].metadata.generation), 1);
    assert.equal(failedAudits[0].metadata.cause, "outbox_terminal");

    const rescheduled = await scans.scheduleForPrincipal({
      principal: ownerWorker.principal,
      fileRef: seeded.fileRef
    });
    assert.equal(rescheduled.created, true);
    assert.equal(rescheduled.generation, 2);
    assert.notEqual(rescheduled.jobId, scheduled.jobId);

    const secondPending = await secureFile(database, seeded.fileRef);
    assert.equal(secondPending.lifecycle_status, "scan_pending");
    assert.equal(Number(secondPending.scan_generation), 2);
    assert.equal(secondPending.scan_job_id, rescheduled.jobId);
    assert.equal(secondPending.scan_result_code, null);
    assert.equal(secondPending.scan_completed_at, null);

    const allJobs = await database.query(
      `SELECT job_id, status, payload
       FROM platform_outbox_jobs
       WHERE job_type = 'secure_file.scan'
       ORDER BY job_sequence`
    );
    assert.equal(allJobs.rows.length, 2);
    assert.equal(allJobs.rows[0].job_id, scheduled.jobId);
    assert.equal(allJobs.rows[0].status, "terminal_failed");
    assert.equal(allJobs.rows[1].job_id, rescheduled.jobId);
    assert.equal(allJobs.rows[1].status, "pending");
    assert.deepEqual(allJobs.rows[1].payload, {
      fileRef: seeded.fileRef,
      generation: 2
    });

    const allQueuedAudits = await scanAudits(database, seeded.fileRef, "secure_file.scan.queued");
    assert.equal(allQueuedAudits.length, 2);
    assert.equal(Number(allQueuedAudits[1].metadata.generation), 2);
    assert.equal(allQueuedAudits[1].metadata.sourceJobId, rescheduled.jobId);

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'scan_runtime_test'
       WHERE session_id = $1`,
      [ownerWorker.sessionId]
    );
    await assert.rejects(
      scans.scheduleForPrincipal({
        principal: ownerWorker.principal,
        fileRef: seeded.fileRef
      })
    );

    const afterDenied = await secureFile(database, seeded.fileRef);
    assert.equal(afterDenied.lifecycle_status, "scan_pending");
    assert.equal(Number(afterDenied.scan_generation), 2);
    assert.equal(afterDenied.scan_job_id, rescheduled.jobId);
  } finally {
    await database.close();
  }
});
