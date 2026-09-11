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
const {
  WorkerEvidenceAttachmentUnavailableError,
  WorkerEvidenceConflictError,
  WorkerEvidenceNotFoundError
} = evidenceDomain;
const { WorkerEvidenceService } = evidenceServiceModule;
const {
  bindTrustedSecureFileOwner,
  createSecureFileReservationIntent,
  deriveSecureFileObjectKey
} = secureFileDomain;
const { validateSecureFileUpload } = uploadDomain;

const OWNED_MIGRATION = "0030_worker_evidence_records";
const NOW = "2026-08-17T01:20:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-worker-evidence-attachments",
  sessionSecret: "m1-11-attachment-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-attachment-auth-pepper-with-more-than-thirty-two-characters",
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
    sessionId: `session_m111_attach_${character}`,
    accountId: `account_m111_attach_${character}`,
    activeRole: "worker",
    accountStatus: "active",
    email: `attach-${character.toLowerCase()}@example.com`,
    displayName: `Attachment Worker ${character}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE,
    tenantMembership: null
  });
}

function qualificationInput(recordId, expectedRevision, title = "NEBOSH IGC") {
  return Object.freeze({
    recordId,
    expectedRevision,
    title,
    category: "Occupational Health and Safety",
    issuingOrganization: "NEBOSH",
    learningProvider: "Approved Learning Partner",
    certificateNumber: "CERT-ATTACH-001",
    issueDate: "2024-01-10",
    expiryDate: "2029-01-10",
    level: "Level 3",
    country: "United Kingdom",
    verificationUrl: "https://example.test/qualification",
    declarationAccepted: true
  });
}

class FakeSecureFiles {
  constructor() {
    this.files = new Map();
    this.sequence = 0;
    this.returnForeignReservation = false;
  }

  async reserveForPrincipal({ principal: actor, businessReference, displayFilename }) {
    const owner = bindTrustedSecureFileOwner(actor);
    const intent = createSecureFileReservationIntent({
      owner,
      businessReference,
      displayFilename
    });
    this.sequence += 1;
    const fileId = `secure_file_${String(this.sequence).padStart(24, "0")}`;
    const file = Object.freeze({
      sequence: this.sequence,
      fileId,
      schemaVersion: 1,
      reservationKey: this.returnForeignReservation ? "f".repeat(64) : intent.reservationKey,
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
    if (!file || file.ownerAccountId !== actor.accountId || file.ownerRole !== actor.activeRole) {
      return null;
    }
    return file;
  }

  update(fileId, patch) {
    const current = this.files.get(fileId);
    assert.ok(current, `Missing fake secure file ${fileId}`);
    const next = Object.freeze({ ...current, ...patch, updatedAt: NOW });
    this.files.set(fileId, next);
    return next;
  }
}

class FakeSecureUploads {
  constructor(files) {
    this.files = files;
    this.policies = [];
  }

  async quarantineForPrincipal(input) {
    const file = await this.files.findForPrincipal(input.principal, input.fileId);
    assert.ok(file);
    this.policies.push(input.policy);
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

class FakeSecureScans {
  constructor(files) {
    this.files = files;
  }

  async scheduleForPrincipal({ principal: actor, fileRef }) {
    const file = await this.files.findForPrincipal(actor, fileRef);
    assert.ok(file);
    this.files.update(fileRef, { lifecycleStatus: "scan_pending" });
    return Object.freeze({ scheduled: true, fileId: fileRef });
  }
}

function attachmentHarness(database, scanOutcome = "available") {
  const files = new FakeSecureFiles();
  const uploads = new FakeSecureUploads(files);
  const scans = new FakeSecureScans(files);
  const settle = async (_principal, fileId) => {
    files.update(
      fileId,
      scanOutcome === "available"
        ? { lifecycleStatus: "available", availableAt: NOW }
        : { lifecycleStatus: scanOutcome, unsafeAt: scanOutcome === "unsafe" ? NOW : null }
    );
  };
  const service = new WorkerEvidenceAttachmentService(
    Promise.resolve(database),
    files,
    uploads,
    scans,
    settle,
    () => new Date(NOW)
  );
  return { service, files, uploads, scans };
}

async function savedQualification(evidence, actor, title = "NEBOSH IGC") {
  const draft = await evidence.createDraft(actor, "qualification");
  return evidence.saveQualificationDraft(
    actor,
    qualificationInput(draft.recordId, draft.currentVersion.revision, title)
  );
}


async function seedAuditActor(database, actor) {
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at, created_at, updated_at
     ) VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)
     ON CONFLICT (account_id) DO NOTHING`,
    [
      actor.accountId,
      actor.email,
      actor.displayName,
      "scrypt$16384$8$1$salt$hash",
      NOW
    ]
  );
}

test("M1.11 qualification attachment reuses the trusted PDF/PNG/JPEG policy and binds only the exact draft version", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);
    const actor = principal("A");
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const qualification = await savedQualification(evidence, actor);
    const { service, uploads } = attachmentHarness(database);

    const attached = await service.uploadAndBind(actor, {
      recordId: qualification.recordId,
      versionId: qualification.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: null,
      originalFilename: "nebosh-certificate.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });

    assert.equal(attached.recordId, qualification.recordId);
    assert.equal(attached.versionId, qualification.currentVersion.versionId);
    assert.equal(attached.attachmentKind, "primary_certificate");
    assert.equal(attached.displayFilename, "nebosh-certificate.pdf");
    assert.equal(uploads.policies.length, 1);
    assert.deepEqual(uploads.policies[0].allowedKinds, ["pdf", "png", "jpeg"]);

    const stored = await database.query(
      `SELECT record_id, version_id, attachment_kind, secure_file_id,
              display_filename, superseded_at
         FROM worker_evidence_attachments
        WHERE attachment_id=$1`,
      [attached.attachmentId]
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].record_id, qualification.recordId);
    assert.equal(stored.rows[0].version_id, qualification.currentVersion.versionId);
    assert.equal(stored.rows[0].superseded_at, null);
  } finally {
    await database.close();
  }
});

test("M1.11 same-Worker file with a foreign reservation key cannot cross-bind into another evidence record/version", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-cross-binding" });
  try {
    await applyMigrationsThrough(database, "m1-11-cross-binding", OWNED_MIGRATION);
    const actor = principal("B");
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const qualification = await savedQualification(evidence, actor, "IOSH Managing Safely");
    const harness = attachmentHarness(database);
    harness.files.returnForeignReservation = true;

    await assert.rejects(
      harness.service.uploadAndBind(actor, {
        recordId: qualification.recordId,
        versionId: qualification.currentVersion.versionId,
        attachmentKind: "primary_certificate",
        expectedActiveAttachmentId: null,
        originalFilename: "iosh.pdf",
        declaredMime: "application/pdf",
        bytes: PDF_BYTES
      }),
      WorkerEvidenceAttachmentUnavailableError
    );

    const bindings = await database.query(
      `SELECT 1 FROM worker_evidence_attachments WHERE record_id=$1`,
      [qualification.recordId]
    );
    assert.equal(bindings.rows.length, 0);
  } finally {
    await database.close();
  }
});

test("M1.11 cross-Worker attachment attempts are non-enumerating and never reserve a file", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-attachment-owner" });
  try {
    await applyMigrationsThrough(database, "m1-11-attachment-owner", OWNED_MIGRATION);
    const workerA = principal("C");
    await seedAuditActor(database, workerA);
    const workerB = principal("D");
    await seedAuditActor(database, workerB);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const qualification = await savedQualification(evidence, workerA);
    const harness = attachmentHarness(database);

    await assert.rejects(
      harness.service.uploadAndBind(workerB, {
        recordId: qualification.recordId,
        versionId: qualification.currentVersion.versionId,
        attachmentKind: "primary_certificate",
        expectedActiveAttachmentId: null,
        originalFilename: "copied.pdf",
        declaredMime: "application/pdf",
        bytes: PDF_BYTES
      }),
      WorkerEvidenceNotFoundError
    );
    assert.equal(harness.files.files.size, 0);
  } finally {
    await database.close();
  }
});

test("M1.11 unsafe or not-yet-available secure files cannot bind", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-unsafe-attachment" });
  try {
    await applyMigrationsThrough(database, "m1-11-unsafe-attachment", OWNED_MIGRATION);
    const actor = principal("E");
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const qualification = await savedQualification(evidence, actor);
    const unsafeHarness = attachmentHarness(database, "unsafe");

    await assert.rejects(
      unsafeHarness.service.uploadAndBind(actor, {
        recordId: qualification.recordId,
        versionId: qualification.currentVersion.versionId,
        attachmentKind: "primary_certificate",
        expectedActiveAttachmentId: null,
        originalFilename: "unsafe.pdf",
        declaredMime: "application/pdf",
        bytes: PDF_BYTES
      }),
      WorkerEvidenceAttachmentUnavailableError
    );
    const bindings = await database.query(
      `SELECT 1 FROM worker_evidence_attachments WHERE record_id=$1`,
      [qualification.recordId]
    );
    assert.equal(bindings.rows.length, 0);
  } finally {
    await database.close();
  }
});

test("M1.11 replacing a primary certificate supersedes only the same slot and submitted versions reject later attachment writes", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-attachment-replace" });
  try {
    await applyMigrationsThrough(database, "m1-11-attachment-replace", OWNED_MIGRATION);
    const actor = principal("F");
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    let qualification = await savedQualification(evidence, actor);
    const harness = attachmentHarness(database);

    const first = await harness.service.uploadAndBind(actor, {
      recordId: qualification.recordId,
      versionId: qualification.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: null,
      originalFilename: "certificate-v1.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });
    const second = await harness.service.uploadAndBind(actor, {
      recordId: qualification.recordId,
      versionId: qualification.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: first.attachmentId,
      originalFilename: "certificate-v2.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });

    const history = await harness.service.listForRecord(actor, qualification.recordId);
    assert.equal(history.length, 2);
    assert.equal(history.find((row) => row.attachmentId === first.attachmentId)?.supersededAt, NOW);
    assert.equal(history.find((row) => row.attachmentId === second.attachmentId)?.supersededAt, null);

    qualification = await evidence.findCurrent(actor, qualification.recordId);
    const submitted = await evidence.submit(
      actor,
      qualification.recordId,
      qualification.currentVersion.revision
    );
    assert.equal(submitted.currentVersion.status, "submitted");

    await assert.rejects(
      harness.service.uploadAndBind(actor, {
        recordId: qualification.recordId,
        versionId: qualification.currentVersion.versionId,
        attachmentKind: "supporting_evidence",
        expectedActiveAttachmentId: null,
        originalFilename: "late.pdf",
        declaredMime: "application/pdf",
        bytes: PDF_BYTES
      }),
      WorkerEvidenceConflictError
    );
  } finally {
    await database.close();
  }
});
