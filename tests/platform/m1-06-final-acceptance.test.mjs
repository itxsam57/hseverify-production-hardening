import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const require = createRequire(import.meta.url);
const runtimeDist = process.env.HSE_M1_06_FINAL_RUNTIME_DIST;
assert.ok(runtimeDist, "HSE_M1_06_FINAL_RUNTIME_DIST must be configured");

const uploadDomain = require(resolve(runtimeDist, "secure-files", "secure-file-upload-domain.js"));
const accessDomain = require(resolve(runtimeDist, "secure-files", "secure-file-access-domain.js"));
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

const NOW = "2026-08-10T05:00:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";
const SECRET = "m1-06-final-acceptance-session-secret-32-characters";

function environment(suffix, pgliteDataDir = "memory://") {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha: `m1-06-final-${suffix}`,
    sessionSecret: SECRET,
    authPepper: "m1-06-final-acceptance-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pdfBytes(label, body = "ordinary clean evidence") {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj\n<< /Label (${label}) >>\nstream\n${body}\nendstream\nendobj\ntrailer\n<<>>\n%%EOF\n`
  );
}

async function seedWorker(database, suffix) {
  const accountId = `account_m106_final_${suffix}`;
  const sessionId = `session_m106_final_${suffix}`;
  const email = `m106-final-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `M1.06 Final ${suffix}`, NOW]
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
      displayName: `M1.06 Final ${suffix}`,
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: EXPIRES,
      tenantMembership: null
    }
  };
}

async function seedCompany(database, suffix, marker) {
  const accountId = `account_m106_company_${suffix}`;
  const sessionId = `session_m106_company_${suffix}`;
  const tenantId = `tenant_${marker.repeat(24)}`;
  const membershipId = `membership_${marker.repeat(24)}`;
  const email = `m106-company-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `M1.06 Company ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `M1.06 Tenant ${suffix}`, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, hash(`company-token:${suffix}`), hash(`company-csrf:${suffix}`), NOW, EXPIRES]
  );
  return {
    accountId,
    sessionId,
    tenantId,
    membershipId,
    principal: {
      sessionId,
      accountId,
      activeRole: "company",
      accountStatus: "active",
      email,
      displayName: `M1.06 Company ${suffix}`,
      createdAt: NOW,
      lastSeenAt: NOW,
      expiresAt: EXPIRES,
      tenantMembership: {
        tenantId,
        tenantStatus: "active",
        membershipId,
        role: "owner",
        status: "active",
        overrides: []
      }
    }
  };
}

async function createContext(suffix) {
  const env = environment(suffix);
  const database = await openScriptDatabase(env);
  await applyPendingMigrations(database, env.releaseSha);
  const directory = await mkdtemp(join(tmpdir(), `hseverify-m106-${suffix}-`));
  const rootPath = join(directory, "private");
  const storage = new LocalTestPrivateObjectStorage({
    appEnvironment: "test",
    trustedBasePath: directory,
    rootPath
  });
  const filesRepository = new DatabaseSecureFileRepository(Promise.resolve(database));
  const files = new SecureFileService(filesRepository);
  const uploadRepository = new DatabaseSecureFileUploadRepository(Promise.resolve(database));
  const uploads = new SecureFileUploadService(files, uploadRepository, storage);
  const scans = new DatabaseSecureFileScanRepository(Promise.resolve(database));
  const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
  const audits = new DatabaseAuditRepository(Promise.resolve(database));
  const scanner = new LocalTestMalwareScanner("test");
  return {
    env,
    database,
    directory,
    rootPath,
    storage,
    filesRepository,
    files,
    uploads,
    scans,
    outbox,
    audits,
    scanner
  };
}

async function closeContext(context) {
  await context.database.close();
  await rm(context.directory, { recursive: true, force: true });
}

async function reserveAndQuarantine(context, principal, suffix, bytes) {
  const displayFilename = `Evidence ${suffix}.pdf`;
  const businessReference = `m1-06-final:${suffix}`;
  const first = await context.files.reserveForPrincipal({
    principal,
    businessReference,
    displayFilename
  });
  assert.equal(first.created, true);
  const replay = await context.files.reserveForPrincipal({
    principal,
    businessReference,
    displayFilename
  });
  assert.equal(replay.created, false);
  assert.equal(replay.file.fileId, first.file.fileId);

  const policy = uploadDomain.createDefaultSecureFileUploadPolicy();
  const quarantined = await context.uploads.quarantineForPrincipal({
    principal,
    policy,
    fileId: first.file.fileId,
    originalFilename: displayFilename,
    declaredMime: "application/pdf",
    bytes
  });
  assert.equal(quarantined.created, true);
  assert.equal(quarantined.file.lifecycleStatus, "quarantined");

  const uploadReplay = await context.uploads.quarantineForPrincipal({
    principal,
    policy,
    fileId: first.file.fileId,
    originalFilename: displayFilename,
    declaredMime: "application/pdf",
    bytes
  });
  assert.equal(uploadReplay.created, false);
  assert.equal(uploadReplay.file.contentSha256, quarantined.file.contentSha256);
  return uploadReplay.file;
}

async function scanToTerminal(context, principal, fileRef) {
  const scheduled = await context.scans.scheduleForPrincipal({ principal, fileRef });
  assert.equal(scheduled.created, true);
  const scheduleReplay = await context.scans.scheduleForPrincipal({ principal, fileRef });
  assert.deepEqual(scheduleReplay, {
    created: false,
    fileRef,
    generation: scheduled.generation,
    jobId: scheduled.jobId
  });
  const claimed = await context.outbox.claimNext(outboxDomain.createTrustedOutboxWorker());
  assert.ok(claimed);
  assert.equal(claimed.job.jobId, scheduled.jobId);
  const result = await handleSecureFileScanJobWithDependencies(
    {
      repository: context.scans,
      storage: context.storage,
      scanner: context.scanner
    },
    claimed.job,
    claimed.lease
  );
  if (result.kind === "succeeded") {
    await context.outbox.succeed(claimed.lease);
  } else if (result.kind === "terminal") {
    await context.outbox.terminalFail(claimed.lease, result.failure);
  } else {
    await context.outbox.retry(claimed.lease, result.failure);
  }
  return { scheduled, result };
}

async function fileState(database, fileRef) {
  const result = await database.query(
    `SELECT lifecycle_status, byte_size, content_sha256, object_key,
            scan_generation, scan_job_id, scan_result_code,
            quarantined_at, scan_completed_at, available_at, unsafe_at
     FROM platform_secure_files WHERE file_id = $1`,
    [fileRef]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function auditActions(database, fileRef) {
  const result = await database.query(
    `SELECT action_key, metadata
     FROM platform_audit_events
     WHERE target_type = 'secure_file' AND target_reference = $1
     ORDER BY audit_sequence`,
    [fileRef]
  );
  return result.rows;
}

test("Worker file crosses the real reserve, quarantine, scan and signed-access boundaries without duplicate material state", async () => {
  const context = await createContext("worker-happy");
  try {
    const owner = await seedWorker(context.database, "worker_happy_owner");
    const other = await seedWorker(context.database, "worker_happy_other");
    const bytes = pdfBytes("worker-happy");
    const quarantined = await reserveAndQuarantine(
      context,
      owner.principal,
      "worker-happy",
      bytes
    );

    const storedStat = await context.storage.stat(quarantined.objectKey);
    assert.deepEqual(storedStat, {
      byteSize: bytes.byteLength,
      sha256: quarantined.contentSha256
    });

    const { result } = await scanToTerminal(
      context,
      owner.principal,
      quarantined.fileId
    );
    assert.deepEqual(result, { kind: "succeeded" });
    const available = await context.files.findForPrincipal(owner.principal, quarantined.fileId);
    assert.ok(available);
    assert.equal(available.lifecycleStatus, "available");

    const databaseState = await fileState(context.database, quarantined.fileId);
    assert.equal(databaseState.lifecycle_status, "available");
    assert.equal(databaseState.scan_result_code, "clean");
    assert.ok(databaseState.quarantined_at);
    assert.ok(databaseState.scan_completed_at);
    assert.ok(databaseState.available_at);
    assert.equal(databaseState.unsafe_at, null);

    await assert.rejects(
      accessCore.authorizeSecureFileAccessCore({
        principal: other.principal,
        fileRef: quarantined.fileId,
        purpose: "preview",
        signingSecret: SECRET,
        repository: context.filesRepository,
        now: new Date(NOW)
      }),
      accessDomain.SecureFileAccessDeniedError
    );

    const issued = await accessCore.authorizeSecureFileAccessCore({
      principal: owner.principal,
      fileRef: quarantined.fileId,
      purpose: "preview",
      signingSecret: SECRET,
      repository: context.filesRepository,
      now: new Date(NOW)
    });
    await appendSecureFileAccessAudit({
      principal: owner.principal,
      action: "secure_file.access.authorized",
      fileRef: quarantined.fileId,
      purpose: "preview",
      expiresAt: issued.expiresAt,
      repository: context.audits
    });

    let storageReads = 0;
    const storage = {
      async read(objectKey) {
        storageReads += 1;
        return context.storage.read(objectKey);
      }
    };
    for (const at of ["2026-08-10T05:00:30.000Z", "2026-08-10T05:01:30.000Z"]) {
      const served = await accessCore.readSecureFileAccessCore({
        principal: owner.principal,
        token: issued.token,
        expectedPurpose: "preview",
        signingSecret: SECRET,
        repository: context.filesRepository,
        storage,
        now: new Date(at)
      });
      assert.deepEqual(Array.from(served.bytes), Array.from(bytes));
      assert.equal(served.headers["Content-Type"], "application/pdf");
      await appendSecureFileAccessAudit({
        principal: owner.principal,
        action: "secure_file.access.served",
        fileRef: quarantined.fileId,
        purpose: "preview",
        byteSize: served.bytes.byteLength,
        repository: context.audits
      });
    }
    assert.equal(storageReads, 2);

    const actions = await auditActions(context.database, quarantined.fileId);
    assert.equal(actions.filter((row) => row.action_key === "secure_file.quarantined").length, 1);
    assert.equal(actions.filter((row) => row.action_key === "secure_file.scan.queued").length, 1);
    assert.equal(actions.filter((row) => row.action_key === "secure_file.scan.available").length, 1);
    assert.equal(actions.filter((row) => row.action_key === "secure_file.access.authorized").length, 1);
    assert.equal(actions.filter((row) => row.action_key === "secure_file.access.served").length, 2);
    const serializedAudit = JSON.stringify(actions);
    assert.equal(serializedAudit.includes(Buffer.from(bytes).toString("base64")), false);
    assert.equal(serializedAudit.includes(quarantined.objectKey), false);
    assert.equal(serializedAudit.includes(quarantined.contentSha256), false);

    await context.database.query(
      `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP,
       revocation_reason = 'm1_06_final' WHERE session_id = $1`,
      [owner.sessionId]
    );
    await assert.rejects(
      accessCore.readSecureFileAccessCore({
        principal: owner.principal,
        token: issued.token,
        expectedPurpose: "preview",
        signingSecret: SECRET,
        repository: context.filesRepository,
        storage,
        now: new Date("2026-08-10T05:01:45.000Z")
      }),
      accessDomain.SecureFileAccessDeniedError
    );
    assert.equal(storageReads, 2, "revoked session must fail before private storage read");
  } finally {
    await closeContext(context);
  }
});

test("malicious evidence becomes unsafe and cannot cross into signed access", async () => {
  const context = await createContext("unsafe");
  try {
    const owner = await seedWorker(context.database, "unsafe_owner");
    const bytes = pdfBytes(
      "unsafe",
      "prefix EICAR-STANDARD-ANTIVIRUS-TEST-FILE suffix"
    );
    const quarantined = await reserveAndQuarantine(
      context,
      owner.principal,
      "unsafe",
      bytes
    );
    const { result } = await scanToTerminal(context, owner.principal, quarantined.fileId);
    assert.deepEqual(result, { kind: "succeeded" });
    const state = await fileState(context.database, quarantined.fileId);
    assert.equal(state.lifecycle_status, "unsafe");
    assert.equal(state.scan_result_code, "eicar_test_signature");
    assert.equal(state.available_at, null);
    assert.ok(state.unsafe_at);

    await assert.rejects(
      accessCore.authorizeSecureFileAccessCore({
        principal: owner.principal,
        fileRef: quarantined.fileId,
        purpose: "preview",
        signingSecret: SECRET,
        repository: context.filesRepository,
        now: new Date(NOW)
      }),
      accessDomain.SecureFileAccessDeniedError
    );
    const actions = await auditActions(context.database, quarantined.fileId);
    assert.equal(actions.filter((row) => row.action_key === "secure_file.scan.unsafe").length, 1);
    assert.equal(actions.filter((row) => row.action_key === "secure_file.scan.available").length, 0);
  } finally {
    await closeContext(context);
  }
});

test("post-scan private-object tampering is denied at final read without changing accepted metadata", async () => {
  const context = await createContext("post-scan-tamper");
  try {
    const owner = await seedWorker(context.database, "tamper_owner");
    const bytes = pdfBytes("tamper-original");
    const quarantined = await reserveAndQuarantine(
      context,
      owner.principal,
      "post-scan-tamper",
      bytes
    );
    const { result } = await scanToTerminal(context, owner.principal, quarantined.fileId);
    assert.deepEqual(result, { kind: "succeeded" });
    const issued = await accessCore.authorizeSecureFileAccessCore({
      principal: owner.principal,
      fileRef: quarantined.fileId,
      purpose: "download",
      signingSecret: SECRET,
      repository: context.filesRepository,
      now: new Date(NOW)
    });

    const tampered = pdfBytes("tamper-changed-content");
    await writeFile(join(context.rootPath, quarantined.objectKey), tampered);
    await assert.rejects(
      accessCore.readSecureFileAccessCore({
        principal: owner.principal,
        token: issued.token,
        expectedPurpose: "download",
        signingSecret: SECRET,
        repository: context.filesRepository,
        storage: context.storage,
        now: new Date("2026-08-10T05:01:00.000Z")
      }),
      accessDomain.SecureFileAccessDeniedError
    );

    const state = await fileState(context.database, quarantined.fileId);
    assert.equal(state.lifecycle_status, "available");
    assert.equal(state.content_sha256, quarantined.contentSha256);
    assert.notEqual(hash(Buffer.from(tampered)), state.content_sha256);
  } finally {
    await closeContext(context);
  }
});

test("Company file remains bound to the exact tenant membership through reserve, scan and signed use", async () => {
  const context = await createContext("company-scope");
  try {
    const owner = await seedCompany(context.database, "owner", "A");
    const other = await seedCompany(context.database, "other", "B");
    const bytes = pdfBytes("company-scope");
    const quarantined = await reserveAndQuarantine(
      context,
      owner.principal,
      "company-scope",
      bytes
    );
    assert.equal(quarantined.tenantId, owner.tenantId);
    assert.equal(quarantined.membershipId, owner.membershipId);

    assert.equal(
      await context.files.findForPrincipal(other.principal, quarantined.fileId),
      null
    );
    await assert.rejects(
      context.scans.scheduleForPrincipal({
        principal: other.principal,
        fileRef: quarantined.fileId
      })
    );

    const { result } = await scanToTerminal(context, owner.principal, quarantined.fileId);
    assert.deepEqual(result, { kind: "succeeded" });
    const issued = await accessCore.authorizeSecureFileAccessCore({
      principal: owner.principal,
      fileRef: quarantined.fileId,
      purpose: "download",
      signingSecret: SECRET,
      repository: context.filesRepository,
      now: new Date(NOW)
    });

    await assert.rejects(
      accessCore.authorizeSecureFileAccessCore({
        principal: other.principal,
        fileRef: quarantined.fileId,
        purpose: "download",
        signingSecret: SECRET,
        repository: context.filesRepository,
        now: new Date(NOW)
      }),
      accessDomain.SecureFileAccessDeniedError
    );

    const continuityAccountId = "account_m106_company_owner_continuity";
    const continuityMembershipId = `membership_${"D".repeat(24)}`;
    await context.database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         email_verified_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
      [continuityAccountId, "m106-company-owner-continuity@example.com", "M1.06 Company continuity owner", NOW]
    );
    await context.database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'company', $2)`,
      [continuityAccountId, NOW]
    );
    await context.database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_by_account_id,
         created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
      [continuityMembershipId, owner.tenantId, continuityAccountId, owner.accountId, NOW]
    );

    await context.database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'suspended', suspended_at = CURRENT_TIMESTAMP
       WHERE membership_id = $1`,
      [owner.membershipId]
    );
    await assert.rejects(
      accessCore.readSecureFileAccessCore({
        principal: owner.principal,
        token: issued.token,
        expectedPurpose: "download",
        signingSecret: SECRET,
        repository: context.filesRepository,
        storage: context.storage,
        now: new Date("2026-08-10T05:01:00.000Z")
      }),
      accessDomain.SecureFileAccessDeniedError
    );
  } finally {
    await closeContext(context);
  }
});
