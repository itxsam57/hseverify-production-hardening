import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_WORKER_EVIDENCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_EVIDENCE_RUNTIME_DIST is required");

const attachmentModule = await import(
  pathToFileURL(join(runtime, "worker-evidence", "worker-evidence-attachment-service.js")).href
);
const evidenceDomain = await import(
  pathToFileURL(join(runtime, "worker-evidence", "worker-evidence-domain.js")).href
);
const evidenceServiceModule = await import(
  pathToFileURL(join(runtime, "worker-evidence", "worker-evidence-service.js")).href
);
const secureFileDomain = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-domain.js")).href
);
const uploadDomain = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-upload-domain.js")).href
);

const { WorkerEvidenceAttachmentService } = attachmentModule;
const { WorkerEvidenceNotFoundError } = evidenceDomain;
const { WorkerEvidenceService } = evidenceServiceModule;
const {
  bindTrustedSecureFileOwner,
  createSecureFileReservationIntent,
  deriveSecureFileObjectKey
} = secureFileDomain;
const { validateSecureFileUpload } = uploadDomain;

const OWNED_MIGRATION = "0030_worker_evidence_records";
const NOW = "2026-08-17T06:10:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-leaving-letter",
  sessionSecret: "m1-11-leaving-letter-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-leaving-letter-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const PDF_BYTES = Uint8Array.from(
  Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "ascii")
);

function principal(character) {
  return Object.freeze({
    sessionId: `session_m111_leave_${character}`,
    accountId: `account_m111_leave_${character}`,
    activeRole: "worker",
    accountStatus: "active",
    email: `leave-${character.toLowerCase()}@example.com`,
    displayName: `Leaving Letter Worker ${character}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE,
    tenantMembership: null
  });
}

async function seedAuditActor(database, actor) {
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at, created_at, updated_at
     ) VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)
     ON CONFLICT (account_id) DO NOTHING`,
    [actor.accountId, actor.email, actor.displayName, "scrypt$16384$8$1$salt$hash", NOW]
  );
}

class FakeSecureFiles {
  constructor() {
    this.files = new Map();
    this.sequence = 0;
  }

  async reserveForPrincipal({ principal: actor, businessReference, displayFilename }) {
    const owner = bindTrustedSecureFileOwner(actor);
    const intent = createSecureFileReservationIntent({ owner, businessReference, displayFilename });
    this.sequence += 1;
    const fileId = `secure_file_leave_${String(this.sequence).padStart(18, "0")}`;
    const file = Object.freeze({
      sequence: this.sequence,
      fileId,
      schemaVersion: 1,
      reservationKey: intent.reservationKey,
      ownerAccountId: actor.accountId,
      ownerRole: actor.activeRole,
      tenantId: null,
      membershipId: null,
      storageAdapterKey: "local_test",
      objectKey: deriveSecureFileObjectKey(fileId),
      displayFilename,
      lifecycleStatus: "reserved",
      fileExtension: null,
      declaredMime: null,
      detectedMime: null,
      byteSize: null,
      contentSha256: null,
      quarantinedAt: null,
      availableAt: null,
      unsafeAt: null,
      createdAt: NOW,
      updatedAt: NOW
    });
    this.files.set(fileId, file);
    return Object.freeze({ created: true, file });
  }

  async findForPrincipal(actor, fileId) {
    const file = this.files.get(fileId) ?? null;
    if (!file || file.ownerAccountId !== actor.accountId || file.ownerRole !== actor.activeRole) return null;
    return file;
  }

  update(fileId, patch) {
    const current = this.files.get(fileId);
    assert.ok(current);
    const next = Object.freeze({ ...current, ...patch, updatedAt: NOW });
    this.files.set(fileId, next);
    return next;
  }
}

class FakeUploads {
  constructor(files) {
    this.files = files;
  }

  async quarantineForPrincipal(input) {
    const file = await this.files.findForPrincipal(input.principal, input.fileId);
    assert.ok(file);
    const validated = validateSecureFileUpload({
      policy: input.policy,
      fileId: file.fileId,
      objectKey: file.objectKey,
      reservedDisplayFilename: file.displayFilename,
      originalFilename: input.originalFilename,
      declaredMime: input.declaredMime,
      bytes: input.bytes
    });
    this.files.update(file.fileId, {
      lifecycleStatus: "quarantined",
      fileExtension: validated.fileExtension,
      declaredMime: validated.declaredMime,
      detectedMime: validated.detectedMime,
      byteSize: validated.byteSize,
      contentSha256: validated.contentSha256,
      quarantinedAt: NOW
    });
    return Object.freeze({ file: this.files.files.get(file.fileId) });
  }
}

class FakeScans {
  constructor(files) {
    this.files = files;
  }

  async scheduleForPrincipal({ principal: actor, fileRef }) {
    assert.ok(await this.files.findForPrincipal(actor, fileRef));
    this.files.update(fileRef, { lifecycleStatus: "scan_pending" });
    return Object.freeze({ scheduled: true, fileId: fileRef });
  }
}

function harness(database) {
  const files = new FakeSecureFiles();
  const uploads = new FakeUploads(files);
  const scans = new FakeScans(files);
  const settle = async (_actor, fileId) => {
    files.update(fileId, { lifecycleStatus: "available", availableAt: NOW });
  };
  return {
    files,
    service: new WorkerEvidenceAttachmentService(
      Promise.resolve(database),
      files,
      uploads,
      scans,
      settle,
      () => new Date(NOW)
    )
  };
}

async function endedEmployment(evidence, actor) {
  const draft = await evidence.createDraft(actor, "employment");
  let saved = await evidence.saveEmploymentDraft(actor, {
    recordId: draft.recordId,
    expectedRevision: draft.currentVersion.revision,
    companyName: "Nesma & Partners",
    roleTitle: "Safety Officer",
    duties: "Site safety inspections and permit assurance.",
    country: "Saudi Arabia",
    startDate: "2024-01-01",
    endDate: null,
    status: "current",
    endReason: null
  });
  saved = await evidence.submit(actor, saved.recordId, saved.currentVersion.revision);
  return evidence.endEmployment(
    actor,
    saved.recordId,
    saved.currentVersion.revision,
    "2026-08-01",
    "Project assignment completed."
  );
}

test("M1.11 leaving letter binds to the exact ended employment version, preserves replacement history and audits the true Worker", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);
    const actor = principal("A");
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const employment = await endedEmployment(evidence, actor);
    const { service } = harness(database);

    const first = await service.uploadLeavingLetter(actor, {
      recordId: employment.recordId,
      versionId: employment.currentVersion.versionId,
      expectedActiveLeavingLetterId: null,
      originalFilename: "leaving-letter.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });
    const replacement = await service.uploadLeavingLetter(actor, {
      recordId: employment.recordId,
      versionId: employment.currentVersion.versionId,
      expectedActiveLeavingLetterId: first.leavingLetterId,
      originalFilename: "leaving-letter-corrected.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });

    const history = await service.listLeavingLetters(actor, employment.recordId);
    assert.equal(history.length, 2);
    assert.equal(history[0].leavingLetterId, first.leavingLetterId);
    assert.equal(history[0].status, "superseded");
    assert.equal(history[0].supersededAt, NOW);
    assert.equal(history[1].leavingLetterId, replacement.leavingLetterId);
    assert.equal(history[1].status, "active");
    assert.equal(history[1].employmentVersionId, employment.currentVersion.versionId);

    const audit = await database.query(
      `SELECT action_key, actor_account_id, actor_role, target_reference
         FROM platform_audit_events
        WHERE action_key IN ('worker_evidence.leaving_letter.attached','worker_evidence.leaving_letter.replaced')
        ORDER BY audit_sequence`
    );
    assert.deepEqual(audit.rows.map((row) => row.action_key), [
      "worker_evidence.leaving_letter.attached",
      "worker_evidence.leaving_letter.replaced"
    ]);
    assert.equal(audit.rows.every((row) => row.actor_account_id === actor.accountId), true);
    assert.equal(audit.rows.every((row) => row.actor_role === "worker"), true);
    assert.equal(audit.rows.every((row) => row.target_reference === employment.recordId), true);
  } finally {
    await database.close();
  }
});

test("M1.11 copied employment IDs cannot be used by another Worker to reserve or attach a leaving letter", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-leaving-letter-owner" });
  try {
    await applyMigrationsThrough(database, "m1-11-leaving-letter-owner", OWNED_MIGRATION);
    const workerA = principal("B");
    const workerB = principal("C");
    await seedAuditActor(database, workerA);
    await seedAuditActor(database, workerB);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const employment = await endedEmployment(evidence, workerA);
    const { service, files } = harness(database);

    await assert.rejects(
      service.uploadLeavingLetter(workerB, {
        recordId: employment.recordId,
        versionId: employment.currentVersion.versionId,
        expectedActiveLeavingLetterId: null,
        originalFilename: "copied.pdf",
        declaredMime: "application/pdf",
        bytes: PDF_BYTES
      }),
      WorkerEvidenceNotFoundError
    );
    assert.equal(files.files.size, 0);
  } finally {
    await database.close();
  }
});
