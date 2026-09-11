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
const domainModule = await import(
  pathToFileURL(join(runtime, "worker-evidence", "worker-evidence-domain.js")).href
);
const serviceModule = await import(
  pathToFileURL(join(runtime, "worker-evidence", "worker-evidence-service.js")).href
);
const secureFileDomain = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-domain.js")).href
);
const uploadDomain = await import(
  pathToFileURL(join(runtime, "secure-files", "secure-file-upload-domain.js")).href
);

const { WorkerEvidenceAttachmentService } = attachmentModule;
const { WorkerEvidenceAttachmentUnavailableError } = domainModule;
const { WorkerEvidenceService } = serviceModule;
const {
  bindTrustedSecureFileOwner,
  createSecureFileReservationIntent,
  deriveSecureFileObjectKey
} = secureFileDomain;
const { validateSecureFileUpload } = uploadDomain;

const OWNED_MIGRATION = "0030_worker_evidence_records";
const NOW = "2026-08-17T01:40:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-qualification-flow",
  sessionSecret: "m1-11-qualification-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-qualification-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const PDF_BYTES = Uint8Array.from(
  Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "ascii")
);

function principal() {
  return Object.freeze({
    sessionId: "session_m111_qualification",
    accountId: "account_m111_qualification",
    activeRole: "worker",
    accountStatus: "active",
    email: "qualification-worker@example.com",
    displayName: "Qualification Worker",
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
    certificateNumber: "CERT-M111-FLOW",
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
  }

  async reserveForPrincipal({ principal: actor, businessReference, displayFilename }) {
    const owner = bindTrustedSecureFileOwner(actor);
    const intent = createSecureFileReservationIntent({ owner, businessReference, displayFilename });
    this.sequence += 1;
    const fileId = `secure_file_${String(this.sequence).padStart(24, "0")}`;
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
    const file = await this.files.findForPrincipal(actor, fileRef);
    assert.ok(file);
    this.files.update(fileRef, { lifecycleStatus: "scan_pending" });
    return Object.freeze({ scheduled: true, fileId: fileRef });
  }
}

function attachments(database) {
  const files = new FakeSecureFiles();
  const uploads = new FakeUploads(files);
  const scans = new FakeScans(files);
  const settle = async (_actor, fileId) => {
    files.update(fileId, { lifecycleStatus: "available", availableAt: NOW });
  };
  return new WorkerEvidenceAttachmentService(
    Promise.resolve(database),
    files,
    uploads,
    scans,
    settle,
    () => new Date(NOW)
  );
}

async function auditRows(database, accountId) {
  const result = await database.query(
    `SELECT actor_account_id, actor_role, action_key, target_reference, metadata
       FROM platform_audit_events
      WHERE actor_account_id=$1
        AND action_key LIKE 'worker_evidence.%'
      ORDER BY audit_sequence`,
    [accountId]
  );
  return result.rows;
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

test("M1.11 qualification cannot submit without the exact active primary certificate and preserves version/file history after revision", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);
    const actor = principal();
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const files = attachments(database);

    const draft = await evidence.createDraft(actor, "qualification");
    let current = await evidence.saveQualificationDraft(
      actor,
      qualificationInput(draft.recordId, draft.currentVersion.revision)
    );

    await assert.rejects(
      evidence.submit(actor, current.recordId, current.currentVersion.revision),
      WorkerEvidenceAttachmentUnavailableError
    );

    const v1Attachment = await files.uploadAndBind(actor, {
      recordId: current.recordId,
      versionId: current.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: null,
      originalFilename: "certificate-v1.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });

    current = await evidence.findCurrent(actor, current.recordId);
    const submitted = await evidence.submit(
      actor,
      current.recordId,
      current.currentVersion.revision
    );
    assert.equal(submitted.currentVersion.status, "submitted");
    assert.equal(submitted.currentVersion.details.title, "NEBOSH IGC");

    const revised = await evidence.startRevision(
      actor,
      submitted.recordId,
      submitted.currentVersion.revision
    );
    assert.equal(revised.currentVersion.versionNumber, 2);
    assert.equal(revised.currentVersion.details.title, "NEBOSH IGC");

    const v2Attachment = await files.uploadAndBind(actor, {
      recordId: revised.recordId,
      versionId: revised.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: null,
      originalFilename: "certificate-v2.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });
    const v2Replacement = await files.uploadAndBind(actor, {
      recordId: revised.recordId,
      versionId: revised.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: v2Attachment.attachmentId,
      originalFilename: "certificate-v2-corrected.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });

    const versionRows = await evidence.listVersions(actor, revised.recordId);
    assert.equal(versionRows.length, 2);
    assert.equal(versionRows[0].details.title, "NEBOSH IGC");
    assert.equal(versionRows[0].status, "submitted");
    assert.equal(versionRows[1].status, "draft");

    const attachmentRows = await files.listForRecord(actor, revised.recordId);
    const v1 = attachmentRows.find((row) => row.attachmentId === v1Attachment.attachmentId);
    const v2 = attachmentRows.find((row) => row.attachmentId === v2Attachment.attachmentId);
    const replacement = attachmentRows.find((row) => row.attachmentId === v2Replacement.attachmentId);
    assert.equal(v1?.versionId, submitted.currentVersion.versionId);
    assert.equal(v1?.displayFilename, "certificate-v1.pdf");
    assert.equal(v1?.supersededAt, null);
    assert.equal(v2?.versionId, revised.currentVersion.versionId);
    assert.equal(v2?.supersededAt, NOW);
    assert.equal(replacement?.versionId, revised.currentVersion.versionId);
    assert.equal(replacement?.supersededAt, null);
  } finally {
    await database.close();
  }
});

test("M1.11 qualification transitions append centralized audit with the true Worker actor", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-qualification-audit" });
  try {
    await applyMigrationsThrough(database, "m1-11-qualification-audit", OWNED_MIGRATION);
    const actor = principal();
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const files = attachments(database);

    const draft = await evidence.createDraft(actor, "qualification");
    let current = await evidence.saveQualificationDraft(
      actor,
      qualificationInput(draft.recordId, draft.currentVersion.revision)
    );
    await files.uploadAndBind(actor, {
      recordId: current.recordId,
      versionId: current.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: null,
      originalFilename: "audit-certificate.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });
    current = await evidence.findCurrent(actor, current.recordId);
    const submitted = await evidence.submit(actor, current.recordId, current.currentVersion.revision);
    await evidence.startRevision(actor, submitted.recordId, submitted.currentVersion.revision);

    const rows = await auditRows(database, actor.accountId);
    assert.deepEqual(
      rows.map((row) => row.action_key),
      [
        "worker_evidence.record.created",
        "worker_evidence.draft.saved",
        "worker_evidence.file.attached",
        "worker_evidence.version.submitted",
        "worker_evidence.revision.started"
      ]
    );
    assert.equal(rows.every((row) => row.actor_account_id === actor.accountId), true);
    assert.equal(rows.every((row) => row.actor_role === "worker"), true);
    assert.equal(rows.every((row) => row.target_reference === draft.recordId), true);
  } finally {
    await database.close();
  }
});
