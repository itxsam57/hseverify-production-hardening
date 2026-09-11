import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_M1_06_FINAL_RUNTIME_DIST;
assert.ok(runtimeDist, "HSE_M1_06_FINAL_RUNTIME_DIST must be configured");

const uploadDomain = require(resolve(runtimeDist, "secure-files", "secure-file-upload-domain.js"));
const accessCore = require(resolve(runtimeDist, "secure-files", "secure-file-access-core.js"));
const { appendSecureFileAccessAudit } = require(
  resolve(runtimeDist, "secure-files", "secure-file-access-audit.js")
);
const { DatabaseSecureFileRepository } = require(
  resolve(runtimeDist, "secure-files", "secure-file-repository.js")
);
const { SecureFileService } = require(
  resolve(runtimeDist, "secure-files", "secure-file-service.js")
);
const { DatabaseSecureFileUploadRepository } = require(
  resolve(runtimeDist, "secure-files", "secure-file-upload-repository.js")
);
const { SecureFileUploadService } = require(
  resolve(runtimeDist, "secure-files", "secure-file-upload-service.js")
);
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
const { DatabaseAuditRepository } = require(
  resolve(runtimeDist, "audit", "audit-repository.js")
);

const NOW = "2026-08-10T05:30:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";
const SECRET = "m1-06-final-restart-session-secret-32-characters";
const OWNED_MIGRATION = "0011_secure_file_foundation";

function env(pgliteDataDir, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: SECRET,
    authPepper: "m1-06-final-restart-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pdfBytes(label) {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj\n<< /Label (${label}) >>\nstream\npersistent clean evidence\nendstream\nendobj\ntrailer\n<<>>\n%%EOF\n`
  );
}

async function seedWorker(database, suffix) {
  const accountId = `account_m106_restart_${suffix}`;
  const sessionId = `session_m106_restart_${suffix}`;
  const email = `m106-restart-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `M1.06 Restart ${suffix}`, NOW]
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
      displayName: `M1.06 Restart ${suffix}`,
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: EXPIRES,
      tenantMembership: null
    }
  };
}

function runtimeContext(database, directory) {
  const rootPath = join(directory, "private");
  const storage = new LocalTestPrivateObjectStorage({
    appEnvironment: "test",
    trustedBasePath: directory,
    rootPath
  });
  const filesRepository = new DatabaseSecureFileRepository(Promise.resolve(database));
  const files = new SecureFileService(filesRepository);
  return {
    rootPath,
    storage,
    filesRepository,
    files,
    uploads: new SecureFileUploadService(
      files,
      new DatabaseSecureFileUploadRepository(Promise.resolve(database)),
      storage
    ),
    scans: new DatabaseSecureFileScanRepository(Promise.resolve(database)),
    outbox: new DatabaseOutboxRepository(Promise.resolve(database)),
    audits: new DatabaseAuditRepository(Promise.resolve(database)),
    scanner: new LocalTestMalwareScanner("test")
  };
}

async function createAvailableFile(context, principal, suffix) {
  const bytes = pdfBytes(suffix);
  const displayFilename = `Persistent ${suffix}.pdf`;
  const reserved = await context.files.reserveForPrincipal({
    principal,
    businessReference: `m1-06-restart:${suffix}`,
    displayFilename
  });
  const quarantined = await context.uploads.quarantineForPrincipal({
    principal,
    policy: uploadDomain.createDefaultSecureFileUploadPolicy(),
    fileId: reserved.file.fileId,
    originalFilename: displayFilename,
    declaredMime: "application/pdf",
    bytes
  });
  const scheduled = await context.scans.scheduleForPrincipal({
    principal,
    fileRef: quarantined.file.fileId
  });
  const claimed = await context.outbox.claimNext(outboxDomain.createTrustedOutboxWorker());
  assert.ok(claimed);
  assert.equal(claimed.job.jobId, scheduled.jobId);
  const handled = await handleSecureFileScanJobWithDependencies(
    {
      repository: context.scans,
      storage: context.storage,
      scanner: context.scanner
    },
    claimed.job,
    claimed.lease
  );
  assert.deepEqual(handled, { kind: "succeeded" });
  await context.outbox.succeed(claimed.lease);
  const available = await context.files.findForPrincipal(principal, quarantined.file.fileId);
  assert.ok(available);
  assert.equal(available.lifecycleStatus, "available");
  return { file: available, bytes };
}

async function appendAndRead(context, principal, file, bytes, now) {
  const issued = await accessCore.authorizeSecureFileAccessCore({
    principal,
    fileRef: file.fileId,
    purpose: "preview",
    signingSecret: SECRET,
    repository: context.filesRepository,
    now
  });
  await appendSecureFileAccessAudit({
    principal,
    action: "secure_file.access.authorized",
    fileRef: file.fileId,
    purpose: "preview",
    expiresAt: issued.expiresAt,
    repository: context.audits
  });
  const served = await accessCore.readSecureFileAccessCore({
    principal,
    token: issued.token,
    expectedPurpose: "preview",
    signingSecret: SECRET,
    repository: context.filesRepository,
    storage: context.storage,
    now: new Date(now.getTime() + 30_000)
  });
  assert.deepEqual(Array.from(served.bytes), Array.from(bytes));
  await appendSecureFileAccessAudit({
    principal,
    action: "secure_file.access.served",
    fileRef: file.fileId,
    purpose: "preview",
    byteSize: served.bytes.byteLength,
    repository: context.audits
  });
}

async function tableExists(database, tableName) {
  const result = await database.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return result.rows.length === 1;
}

test("available metadata, private bytes, scan binding and access history survive PGlite/private-storage close and reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m106-restart-"));
  const databasePath = join(directory, "pglite");
  const environment = env(databasePath, "m1-06-final-restart");
  let database = await openScriptDatabase(environment);
  try {
    await applyPendingMigrations(database, environment.releaseSha);
    const owner = await seedWorker(database, "owner");
    let context = runtimeContext(database, directory);
    const accepted = await createAvailableFile(
      context,
      owner.principal,
      "accepted"
    );
    await appendAndRead(
      context,
      owner.principal,
      accepted.file,
      accepted.bytes,
      new Date(NOW)
    );

    const beforeClose = await database.query(
      `SELECT lifecycle_status, object_key, content_sha256,
              scan_generation, scan_job_id, scan_result_code, available_at
       FROM platform_secure_files WHERE file_id = $1`,
      [accepted.file.fileId]
    );
    assert.equal(beforeClose.rows[0].lifecycle_status, "available");
    assert.equal(beforeClose.rows[0].scan_result_code, "clean");
    assert.ok(beforeClose.rows[0].scan_job_id);
    assert.ok(beforeClose.rows[0].available_at);
    const objectStat = await context.storage.stat(accepted.file.objectKey);
    assert.deepEqual(objectStat, {
      byteSize: accepted.bytes.byteLength,
      sha256: accepted.file.contentSha256
    });

    await database.close();
    database = null;

    const reopened = await openScriptDatabase(environment);
    try {
      context = runtimeContext(reopened, directory);
      const retained = await context.files.findForPrincipal(
        owner.principal,
        accepted.file.fileId
      );
      assert.ok(retained);
      assert.equal(retained.lifecycleStatus, "available");
      assert.equal(retained.objectKey, accepted.file.objectKey);
      assert.equal(retained.contentSha256, accepted.file.contentSha256);
      const retainedBytes = await context.storage.read(retained.objectKey);
      assert.deepEqual(Array.from(retainedBytes), Array.from(accepted.bytes));

      await appendAndRead(
        context,
        owner.principal,
        retained,
        accepted.bytes,
        new Date("2026-08-10T05:31:00.000Z")
      );

      const jobs = await reopened.query(
        `SELECT status, payload FROM platform_outbox_jobs
         WHERE job_type = 'secure_file.scan'
           AND payload ->> 'fileRef' = $1`,
        [retained.fileId]
      );
      assert.equal(jobs.rows.length, 1);
      assert.equal(jobs.rows[0].status, "succeeded");
      assert.deepEqual(jobs.rows[0].payload, {
        fileRef: retained.fileId,
        generation: 1
      });

      const audits = await reopened.query(
        `SELECT action_key FROM platform_audit_events
         WHERE target_reference = $1 ORDER BY audit_sequence`,
        [retained.fileId]
      );
      const actions = audits.rows.map((row) => row.action_key);
      assert.equal(actions.filter((action) => action === "secure_file.quarantined").length, 1);
      assert.equal(actions.filter((action) => action === "secure_file.scan.queued").length, 1);
      assert.equal(actions.filter((action) => action === "secure_file.scan.available").length, 1);
      assert.equal(actions.filter((action) => action === "secure_file.access.authorized").length, 2);
      assert.equal(actions.filter((action) => action === "secure_file.access.served").length, 2);

      const status = await migrationStatus(reopened);
      assert.equal(status.every((entry) => entry.applied && entry.checksumMatches), true);
      assert.deepEqual(await applyPendingMigrations(reopened, "m1-06-final-reopened"), []);
    } finally {
      await reopened.close();
    }
  } finally {
    if (database) await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("full M1.06 migration ownership can roll back and reapply while retaining accepted M1.01-M1.05 account and audit history", async () => {
  const environment = env("memory://", "m1-06-final-migration");
  const database = await openScriptDatabase(environment);
  const migrations = await listMigrations();
  const ids = migrations.map((migration) => migration.id);
  const ownedIndex = ids.indexOf(OWNED_MIGRATION);
  assert.ok(ownedIndex >= 0, "M1.06 secure-file foundation migration must remain registered");
  assert.equal(ids[ownedIndex - 1], "0010_email_delivery_foundation");

  const previousRollbackAcknowledgement = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  try {
    assert.deepEqual(await applyPendingMigrations(database, environment.releaseSha), ids);
    const owner = await seedWorker(database, "migration_history");
    const acceptedAuditId = "audit_m106_final_retained_history";
    await database.query(
      `INSERT INTO platform_audit_events (
         audit_event_id, source_kind, actor_account_id, actor_role,
         action_key, outcome, target_type, target_reference, metadata
       ) VALUES ($1, 'native', $2, 'worker',
         'authorization.access.denied', 'denied', 'resource', $3, '{}'::jsonb)`,
      [acceptedAuditId, owner.accountId, "resource_m106_final_retained"]
    );
    const accessAuditId = "audit_m106_final_access_history";
    await database.query(
      `INSERT INTO platform_audit_events (
         audit_event_id, source_kind, actor_account_id, actor_role,
         action_key, outcome, target_type, target_reference, metadata
       ) VALUES ($1, 'native', $2, 'worker',
         'secure_file.access.authorized', 'succeeded', 'secure_file', $3,
         '{"purpose":"preview"}'::jsonb)`,
      [accessAuditId, owner.accountId, `secure_file_${"R".repeat(24)}`]
    );

    const rolledBack = [];
    while (rolledBack.at(-1) !== OWNED_MIGRATION) {
      const id = await rollbackLatestMigration(database, environment);
      assert.ok(id, `expected rollback to reach ${OWNED_MIGRATION}`);
      rolledBack.push(id);
    }
    assert.equal(await tableExists(database, "platform_secure_files"), false);

    const retainedAccount = await database.query(
      "SELECT account_id FROM auth_accounts WHERE account_id = $1",
      [owner.accountId]
    );
    const retainedAudits = await database.query(
      `SELECT audit_event_id FROM platform_audit_events
       WHERE audit_event_id IN ($1, $2) ORDER BY audit_event_id`,
      [acceptedAuditId, accessAuditId]
    );
    assert.equal(retainedAccount.rows.length, 1);
    assert.equal(retainedAudits.rows.length, 2);

    const afterRollback = await migrationStatus(database);
    for (let index = 0; index < afterRollback.length; index += 1) {
      assert.equal(afterRollback[index].checksumMatches, true);
      assert.equal(afterRollback[index].applied, index < ownedIndex);
    }

    const expectedReapply = [...rolledBack].reverse();
    assert.deepEqual(
      await applyPendingMigrations(database, `${environment.releaseSha}-reapply`),
      expectedReapply
    );
    const finalStatus = await migrationStatus(database);
    assert.equal(finalStatus.every((entry) => entry.applied && entry.checksumMatches), true);
    assert.equal(await tableExists(database, "platform_secure_files"), true);
    const stillRetained = await database.query(
      `SELECT audit_event_id FROM platform_audit_events
       WHERE audit_event_id IN ($1, $2)`,
      [acceptedAuditId, accessAuditId]
    );
    assert.equal(stillRetained.rows.length, 2);
  } finally {
    if (previousRollbackAcknowledgement === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previousRollbackAcknowledgement;
    }
    await database.close();
  }
});
