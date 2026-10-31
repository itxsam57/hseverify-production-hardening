import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_SECURE_SCAN_HANDLER_RUNTIME_DIST ?? resolve(".secure-scan-handler-runtime-test-dist");

const runtimeModules = [
  "auth/auth-domain.ts",
  "authorization/authorization-domain.ts",
  "authorization/authorization-context-domain.ts",
  "authorization/tenant-scoped-resource-domain.ts",
  "authorization/tenant-scoped-command-guard.ts",
  "audit/audit-domain.ts",
  "audit/audit-repository.ts",
  "outbox/outbox-domain.ts",
  "outbox/outbox-repository.ts",
  "secure-files/secure-file-domain.ts",
  "secure-files/secure-file-scan-domain.ts",
  "secure-files/secure-file-scan-repository.ts",
  "secure-files/secure-file-scan-handler-core.ts",
  "secure-files/malware-scanner-core.ts",
  "secure-files/private-object-storage-core.ts"
];

async function ensureRuntimeDist() {
  for (const modulePath of runtimeModules) {
    const source = (await readFile(resolve("src/lib", modulePath), "utf8"))
      .replace(/^import "server-only";\r?\n\r?\n?/, "");
    const destination = resolve(runtimeDist, modulePath.replace(/\.ts$/, ".js"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText);
  }
  const databaseDestination = resolve(runtimeDist, "database", "database.js");
  await mkdir(dirname(databaseDestination), { recursive: true });
  await writeFile(databaseDestination, "exports.getDatabaseClient = async () => { throw new Error('test injects database'); };\n");
  // This scanner-only runtime invokes actual outbox persistence, but never
  // unrelated report/email business finalization. The current outbox module
  // imports these modules eagerly; fail loudly if a test accidentally routes
  // to them rather than silently simulating their side effects.
  for (const [relativePath, exported] of [
    ["reports/report-generation-finalizer.js", "finalizeReportGenerationFailure"],
    ["reports/report-email-handler.js", "finalizeReportEmailFailure"],
    ["email-delivery/assurance-event-email-finalizer.js", "finalizeAssuranceEventEmailFailure"]
  ]) {
    const destination = resolve(runtimeDist, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination,
      `exports.${exported} = async (_database, job) => { if (job.jobType !== "secure_file.scan") throw new Error("Unexpected unrelated finalizer in scanner test"); };\n`);
  }
}

await ensureRuntimeDist();

const scanDomain = require(resolve(runtimeDist, "secure-files", "secure-file-scan-domain.js"));
const { DatabaseSecureFileScanRepository } = require(
  resolve(runtimeDist, "secure-files", "secure-file-scan-repository.js")
);
const { handleSecureFileScanJobWithDependencies } = require(
  resolve(runtimeDist, "secure-files", "secure-file-scan-handler-core.js")
);
const { LocalTestMalwareScanner } = require(
  resolve(runtimeDist, "secure-files", "malware-scanner-core.js")
);
const { LocalTestPrivateObjectStorage } = require(
  resolve(runtimeDist, "secure-files", "private-object-storage-core.js")
);
const outboxDomain = require(resolve(runtimeDist, "outbox", "outbox-domain.js"));
const { DatabaseOutboxRepository } = require(
  resolve(runtimeDist, "outbox", "outbox-repository.js")
);

const NOW = "2026-08-09T20:30:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";
const BASE_ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-scan-handler-runtime",
  sessionSecret: "secure-file-scan-handler-session-secret-32-chars",
  authPepper: "secure-file-scan-handler-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function environment(suffix) {
  return { ...BASE_ENVIRONMENT, releaseSha: `secure-file-scan-handler-${suffix}` };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

async function seedWorker(database, suffix) {
  const accountId = `account_scan_handler_${suffix}`;
  const sessionId = `session_scan_handler_${suffix}`;
  const email = `scan-handler-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `Scan Handler ${suffix}`, NOW]
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
    principal: {
      sessionId,
      accountId,
      activeRole: "worker",
      accountStatus: "active",
      email,
      displayName: `Scan Handler ${suffix}`,
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: EXPIRES,
      tenantMembership: null
    }
  };
}

async function seedQuarantinedFile(database, worker, marker, content) {
  const fileRef = `secure_file_${marker.repeat(24)}`;
  const objectKey = `secure-files/${hash(`object:${marker}`)}`;
  const contentSha256 = scanDomain.computeSecureFileContentSha256(content);
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL,
       'local_test', $4, 'scan.pdf')`,
    [fileRef, hash(`reservation:${marker}`), worker.accountId, objectKey]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined',
         file_extension = 'pdf',
         declared_mime = 'application/pdf',
         detected_mime = 'application/pdf',
         byte_size = $2,
         content_sha256 = $3
     WHERE file_id = $1`,
    [fileRef, content.byteLength, contentSha256]
  );
  return { fileRef, objectKey, contentSha256 };
}

async function state(database, fileRef) {
  const result = await database.query(
    `SELECT lifecycle_status, scan_generation, scan_job_id,
            scan_result_code, scan_completed_at, available_at, unsafe_at
     FROM platform_secure_files WHERE file_id = $1`,
    [fileRef]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function auditCount(database, fileRef, action) {
  const result = await database.query(
    `SELECT COUNT(*) AS count
     FROM platform_audit_events
     WHERE target_reference = $1 AND action_key = $2`,
    [fileRef, action]
  );
  return Number(result.rows[0].count);
}

async function forceRetryDue(database, jobId) {
  await database.query(
    `UPDATE platform_outbox_jobs
     SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second',
         updated_at = CURRENT_TIMESTAMP
     WHERE job_id = $1 AND status = 'retry_wait'`,
    [jobId]
  );
}

async function setupCase(suffix, marker, content, writeObject = true) {
  const env = environment(suffix);
  const database = await openScriptDatabase(env);
  await applyPendingMigrations(database, env.releaseSha);
  const worker = await seedWorker(database, suffix);
  const file = await seedQuarantinedFile(database, worker, marker, content);
  const directory = await mkdtemp(join(tmpdir(), `hseverify-scan-${suffix}-`));
  const storage = new LocalTestPrivateObjectStorage({
    appEnvironment: "test",
    trustedBasePath: directory,
    rootPath: join(directory, "private")
  });
  if (writeObject) await storage.put(file.objectKey, content);
  const scans = new DatabaseSecureFileScanRepository(Promise.resolve(database));
  const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
  const scanner = new LocalTestMalwareScanner("test");
  return { env, database, worker, file, directory, storage, scans, outbox, scanner };
}

async function closeCase(context) {
  await context.database.close();
  await rm(context.directory, { recursive: true, force: true });
}

async function scheduleAndClaim(context) {
  const scheduled = await context.scans.scheduleForPrincipal({
    principal: context.worker.principal,
    fileRef: context.file.fileRef
  });
  const claimed = await context.outbox.claimNext(outboxDomain.createTrustedOutboxWorker());
  assert.ok(claimed);
  assert.equal(claimed.job.jobId, scheduled.jobId);
  return { scheduled, claimed };
}

function dependencies(context, storage = context.storage) {
  return {
    repository: context.scans,
    storage,
    scanner: context.scanner
  };
}

test("clean scan becomes available exactly once even if handler repeats before outbox success", async () => {
  const context = await setupCase("clean", "A", bytes("ordinary clean evidence"));
  try {
    const { claimed } = await scheduleAndClaim(context);
    const first = await handleSecureFileScanJobWithDependencies(
      dependencies(context),
      claimed.job,
      claimed.lease
    );
    assert.deepEqual(first, { kind: "succeeded" });
    const available = await state(context.database, context.file.fileRef);
    assert.equal(available.lifecycle_status, "available");
    assert.equal(available.scan_result_code, "clean");
    assert.ok(available.scan_completed_at);
    assert.ok(available.available_at);
    assert.equal(available.unsafe_at, null);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 1);

    const replay = await handleSecureFileScanJobWithDependencies(
      dependencies(context),
      claimed.job,
      claimed.lease
    );
    assert.deepEqual(replay, { kind: "succeeded" });
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 1);

    const succeeded = await context.outbox.succeed(claimed.lease);
    assert.equal(succeeded.status, "succeeded");
  } finally {
    await closeCase(context);
  }
});

test("EICAR fixture becomes unsafe and never available", async () => {
  const context = await setupCase(
    "malicious",
    "B",
    bytes("prefix EICAR-STANDARD-ANTIVIRUS-TEST-FILE suffix")
  );
  try {
    const { claimed } = await scheduleAndClaim(context);
    const result = await handleSecureFileScanJobWithDependencies(
      dependencies(context), claimed.job, claimed.lease
    );
    assert.deepEqual(result, { kind: "succeeded" });
    const unsafe = await state(context.database, context.file.fileRef);
    assert.equal(unsafe.lifecycle_status, "unsafe");
    assert.equal(unsafe.scan_result_code, "eicar_test_signature");
    assert.equal(unsafe.available_at, null);
    assert.ok(unsafe.unsafe_at);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.unsafe"), 1);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 0);
    await context.outbox.succeed(claimed.lease);
  } finally {
    await closeCase(context);
  }
});

test("retry-once remains scan_pending then succeeds on the second leased attempt", async () => {
  const context = await setupCase("retryonce", "C", bytes("HSE_VERIFY_SCAN_RETRY_ONCE"));
  try {
    const { scheduled, claimed } = await scheduleAndClaim(context);
    const first = await handleSecureFileScanJobWithDependencies(
      dependencies(context), claimed.job, claimed.lease
    );
    assert.equal(first.kind, "retryable");
    assert.equal(first.failure.code, "local_test_retry_once");
    const retrying = await context.outbox.retry(claimed.lease, first.failure);
    assert.equal(retrying.status, "retry_wait");
    const pending = await state(context.database, context.file.fileRef);
    assert.equal(pending.lifecycle_status, "scan_pending");
    assert.equal(pending.scan_result_code, null);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 0);

    await forceRetryDue(context.database, scheduled.jobId);
    const second = await context.outbox.claimNext(outboxDomain.createTrustedOutboxWorker());
    assert.ok(second);
    assert.equal(second.job.jobId, scheduled.jobId);
    assert.equal(second.lease.attemptNumber, 2);
    const result = await handleSecureFileScanJobWithDependencies(
      dependencies(context), second.job, second.lease
    );
    assert.deepEqual(result, { kind: "succeeded" });
    await context.outbox.succeed(second.lease);
    const available = await state(context.database, context.file.fileRef);
    assert.equal(available.lifecycle_status, "available");
    assert.equal(available.scan_result_code, "clean");
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 1);
  } finally {
    await closeCase(context);
  }
});

test("retry exhaustion terminalizes the linked file instead of leaving scan_pending", async () => {
  const context = await setupCase("retryalways", "D", bytes("HSE_VERIFY_SCAN_RETRY_ALWAYS"));
  try {
    const scheduled = await context.scans.scheduleForPrincipal({
      principal: context.worker.principal,
      fileRef: context.file.fileRef
    });
    let finalJob = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = await context.outbox.claimNext(outboxDomain.createTrustedOutboxWorker());
      assert.ok(claimed, `attempt ${attempt} must be claimable`);
      assert.equal(claimed.job.jobId, scheduled.jobId);
      assert.equal(claimed.lease.attemptNumber, attempt);
      const result = await handleSecureFileScanJobWithDependencies(
        dependencies(context), claimed.job, claimed.lease
      );
      assert.equal(result.kind, "retryable");
      finalJob = await context.outbox.retry(claimed.lease, result.failure);
      if (attempt < 5) {
        assert.equal(finalJob.status, "retry_wait");
        await forceRetryDue(context.database, scheduled.jobId);
      }
    }
    assert.ok(finalJob);
    assert.equal(finalJob.status, "terminal_failed");
    const failed = await state(context.database, context.file.fileRef);
    assert.equal(failed.lifecycle_status, "scan_failed");
    assert.equal(failed.scan_job_id, scheduled.jobId);
    assert.equal(failed.scan_result_code, "local_test_retryable");
    assert.ok(failed.scan_completed_at);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.failed"), 1);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 0);
  } finally {
    await closeCase(context);
  }
});

test("missing or tampered private object fails closed and never becomes available", async () => {
  for (const scenario of ["missing", "tampered"]) {
    const accepted = bytes(`accepted-${scenario}`);
    const context = await setupCase(scenario, scenario === "missing" ? "E" : "F", accepted, scenario !== "missing");
    try {
      const { claimed } = await scheduleAndClaim(context);
      const reader = scenario === "tampered"
        ? { read: async () => bytes("different bytes after quarantine") }
        : context.storage;
      const result = await handleSecureFileScanJobWithDependencies(
        dependencies(context, reader), claimed.job, claimed.lease
      );
      assert.equal(result.kind, "terminal");
      assert.equal(
        result.failure.code,
        scenario === "missing" ? "private_object_missing" : "private_object_mismatch"
      );
      await context.outbox.terminalFail(claimed.lease, result.failure);
      const failed = await state(context.database, context.file.fileRef);
      assert.equal(failed.lifecycle_status, "scan_failed");
      assert.equal(failed.scan_result_code, result.failure.code);
      assert.equal(failed.available_at, null);
      assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 0);
    } finally {
      await closeCase(context);
    }
  }
});

test("expired stale lease cannot mutate scan result and a reclaimed lease can finish safely", async () => {
  const context = await setupCase("stale", "G", bytes("clean after reclaim"));
  try {
    const { scheduled, claimed } = await scheduleAndClaim(context);
    await context.database.query(
      `UPDATE platform_outbox_jobs
       SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second',
           updated_at = CURRENT_TIMESTAMP
       WHERE job_id = $1 AND status = 'leased'`,
      [scheduled.jobId]
    );
    await assert.rejects(
      handleSecureFileScanJobWithDependencies(
        dependencies(context), claimed.job, claimed.lease
      )
    );
    const stillPending = await state(context.database, context.file.fileRef);
    assert.equal(stillPending.lifecycle_status, "scan_pending");
    assert.equal(stillPending.scan_result_code, null);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 0);

    const reclaimed = await context.outbox.claimNext(outboxDomain.createTrustedOutboxWorker());
    assert.ok(reclaimed);
    assert.equal(reclaimed.job.jobId, scheduled.jobId);
    assert.equal(reclaimed.lease.attemptNumber, 2);
    const result = await handleSecureFileScanJobWithDependencies(
      dependencies(context), reclaimed.job, reclaimed.lease
    );
    assert.deepEqual(result, { kind: "succeeded" });
    await context.outbox.succeed(reclaimed.lease);
    const available = await state(context.database, context.file.fileRef);
    assert.equal(available.lifecycle_status, "available");
    assert.equal(available.scan_result_code, "clean");
  } finally {
    await closeCase(context);
  }
});

test("scanner outage retains quarantine provenance; retry uses same immutable object and can publish only its own clean result", async () => {
  const accepted = bytes("reviewer-approved-original-scan-object");
  const context = await setupCase("offlineimmutable", "G", accepted);
  try {
    const { scheduled, claimed } = await scheduleAndClaim(context);
    const expectedDigest = context.file.contentSha256;
    const failing = await handleSecureFileScanJobWithDependencies({
      ...dependencies(context),
      scanner: { scan: async () => { throw new Error("scanner unavailable in controlled outage"); } }
    }, claimed.job, claimed.lease);
    assert.equal(failing.kind, "retryable");
    assert.equal(failing.failure.code, "scanner_error");
    const waiting = await state(context.database, context.file.fileRef);
    assert.equal(waiting.lifecycle_status, "scan_pending");
    assert.equal(waiting.scan_job_id, scheduled.jobId);
    assert.equal(waiting.scan_result_code, null);
    assert.equal(waiting.available_at, null);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 0);

    // Concurrent retry or caller replay must not substitute new bytes under
    // the original accepted private object key, even before scan recovers.
    await assert.rejects(context.storage.put(context.file.objectKey, bytes("substituted-untrusted-evidence")),
      error => error?.name === "PrivateObjectConflictError");
    assert.deepEqual(Buffer.from(await context.storage.read(context.file.objectKey)), Buffer.from(accepted));
    assert.equal((await context.storage.put(context.file.objectKey, accepted)).sha256, expectedDigest);
    const blocked = await context.scans.scheduleForPrincipal({
      principal: context.worker.principal, fileRef: context.file.fileRef
    });
    assert.equal(blocked.created, false,"Concurrent scheduling reuses the same pending scan generation and job.");
    assert.equal(blocked.jobId, scheduled.jobId);

    const retry = await context.outbox.retry(claimed.lease, failing.failure);
    assert.equal(retry.status, "retry_wait");
    await forceRetryDue(context.database, scheduled.jobId);
    const recovered = await context.outbox.claimNext(outboxDomain.createTrustedOutboxWorker());
    assert.ok(recovered);
    assert.equal(recovered.job.jobId, scheduled.jobId);
    assert.equal(recovered.lease.attemptNumber, 2);
    assert.deepEqual(await handleSecureFileScanJobWithDependencies(
      dependencies(context), recovered.job, recovered.lease), { kind: "succeeded" });
    await context.outbox.succeed(recovered.lease);
    const available = await state(context.database, context.file.fileRef);
    assert.equal(available.lifecycle_status, "available");
    assert.equal(available.scan_result_code, "clean");
    assert.ok(available.available_at);
    assert.equal(available.scan_generation, waiting.scan_generation);
    assert.equal(available.scan_job_id, waiting.scan_job_id);
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 1);
    assert.deepEqual(Buffer.from(await context.storage.read(context.file.objectKey)), Buffer.from(accepted));
    await assert.rejects(context.storage.put(context.file.objectKey, bytes("later-substituted-evidence")),
      error => error?.name === "PrivateObjectConflictError");
    await assert.rejects(context.scans.scheduleForPrincipal({
      principal: context.worker.principal, fileRef: context.file.fileRef
    }),error=>error?.name === "SecureFileScanConflictError",
    "An available scanned file can never be scheduled for another scan that might overwrite acceptance.");
    assert.equal(await auditCount(context.database, context.file.fileRef, "secure_file.scan.available"), 1);
    console.log("M10603_SCANNER_OUTAGE locked pending file, single idempotent scan generation, storage overwrite denied, recovered clean on same exact bytes and one audit");
  } finally {
    await closeCase(context);
  }
});
