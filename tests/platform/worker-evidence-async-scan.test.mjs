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
const NOW = "2026-08-17T06:50:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-async-scan",
  sessionSecret: "m1-11-async-scan-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-async-scan-auth-pepper-with-more-than-thirty-two-characters",
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
    sessionId: `session_m111_async_${character}`,
    accountId: `account_m111_async_${character}`,
    activeRole: "worker",
    accountStatus: "active",
    email: `async-${character.toLowerCase()}@example.com`,
    displayName: `Async Scan Worker ${character}`,
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
     ) VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
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
    const fileId = `secure_file_async_${String(this.sequence).padStart(18, "0")}`;
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

function asyncAttachments(database) {
  const files = new FakeSecureFiles();
  return {
    files,
    service: new WorkerEvidenceAttachmentService(
      Promise.resolve(database),
      files,
      new FakeUploads(files),
      new FakeScans(files),
      async () => undefined,
      () => new Date(NOW)
    )
  };
}

async function qualification(evidence, actor) {
  const draft = await evidence.createDraft(actor, "qualification");
  return evidence.saveQualificationDraft(actor, {
    recordId: draft.recordId,
    expectedRevision: draft.currentVersion.revision,
    title: "NEBOSH IGC",
    category: "Occupational Health and Safety",
    issuingOrganization: "NEBOSH",
    learningProvider: "Approved Learning Partner",
    certificateNumber: "ASYNC-CERT-001",
    issueDate: "2024-01-10",
    expiryDate: "2029-01-10",
    level: "Level 3",
    country: "United Kingdom",
    verificationUrl: "https://example.test/async-qualification",
    declarationAccepted: true
  });
}

async function endedEmployment(evidence, actor) {
  const draft = await evidence.createDraft(actor, "employment");
  let saved = await evidence.saveEmploymentDraft(actor, {
    recordId: draft.recordId,
    expectedRevision: draft.currentVersion.revision,
    companyName: "Nesma & Partners",
    roleTitle: "Safety Officer",
    duties: "Site safety inspections",
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
    "Assignment completed"
  );
}

test("M1.11 production-style async qualification scan persists a pending exact-slot candidate and finalizes only after the file becomes available", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);
    const actor = principal("Q");
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const record = await qualification(evidence, actor);
    const { files, service } = asyncAttachments(database);

    const pending = await service.uploadAndBind(actor, {
      recordId: record.recordId,
      versionId: record.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: null,
      originalFilename: "async-certificate.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });

    assert.equal(typeof pending.candidateId, "string");
    assert.equal(pending.recordId, record.recordId);
    assert.equal(pending.versionId, record.currentVersion.versionId);
    assert.equal(pending.bindingKind, "primary_certificate");
    assert.equal(pending.scanStatus, "scan_pending");
    assert.equal((await service.listForRecord(actor, record.recordId)).length, 0);

    await assert.rejects(
      evidence.submit(actor, record.recordId, record.currentVersion.revision),
      WorkerEvidenceAttachmentUnavailableError
    );

    files.update(pending.secureFileId, {
      lifecycleStatus: "available",
      availableAt: NOW
    });
    const attached = await service.finalizePendingCandidate(actor, pending.candidateId);
    assert.equal(attached.attachmentId.length > 0, true);
    assert.equal(attached.secureFileId, pending.secureFileId);

    const latest = await evidence.findCurrent(actor, record.recordId);
    const submitted = await evidence.submit(
      actor,
      latest.recordId,
      latest.currentVersion.revision
    );
    assert.equal(submitted.currentVersion.status, "submitted");
  } finally {
    await database.close();
  }
});

test("M1.11 pending replacement never displaces a clean active attachment before scan success", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-async-replacement" });
  try {
    await applyMigrationsThrough(database, "m1-11-async-replacement", OWNED_MIGRATION);
    const actor = principal("R");
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const record = await qualification(evidence, actor);
    const { files, service } = asyncAttachments(database);

    const firstPending = await service.uploadAndBind(actor, {
      recordId: record.recordId,
      versionId: record.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: null,
      originalFilename: "first.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });
    files.update(firstPending.secureFileId, { lifecycleStatus: "available", availableAt: NOW });
    const first = await service.finalizePendingCandidate(actor, firstPending.candidateId);

    const replacement = await service.uploadAndBind(actor, {
      recordId: record.recordId,
      versionId: record.currentVersion.versionId,
      attachmentKind: "primary_certificate",
      expectedActiveAttachmentId: first.attachmentId,
      originalFilename: "replacement.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });
    assert.equal(replacement.scanStatus, "scan_pending");

    const before = await service.listForRecord(actor, record.recordId);
    assert.equal(before.find((row) => row.attachmentId === first.attachmentId)?.supersededAt, null);

    files.update(replacement.secureFileId, { lifecycleStatus: "unsafe", unsafeAt: NOW });
    await assert.rejects(
      service.finalizePendingCandidate(actor, replacement.candidateId),
      WorkerEvidenceAttachmentUnavailableError
    );
    const after = await service.listForRecord(actor, record.recordId);
    assert.equal(after.find((row) => row.attachmentId === first.attachmentId)?.supersededAt, null);
  } finally {
    await database.close();
  }
});

test("M1.11 production-style async leaving-letter scan finalizes only after clean availability", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-async-leaving-letter" });
  try {
    await applyMigrationsThrough(database, "m1-11-async-leaving-letter", OWNED_MIGRATION);
    const actor = principal("L");
    await seedAuditActor(database, actor);
    const evidence = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const employment = await endedEmployment(evidence, actor);
    const { files, service } = asyncAttachments(database);

    const pending = await service.uploadLeavingLetter(actor, {
      recordId: employment.recordId,
      versionId: employment.currentVersion.versionId,
      expectedActiveLeavingLetterId: null,
      originalFilename: "async-leaving-letter.pdf",
      declaredMime: "application/pdf",
      bytes: PDF_BYTES
    });
    assert.equal(pending.bindingKind, "leaving_letter");
    assert.equal(pending.scanStatus, "scan_pending");
    assert.equal((await service.listLeavingLetters(actor, employment.recordId)).length, 0);

    files.update(pending.secureFileId, { lifecycleStatus: "available", availableAt: NOW });
    const letter = await service.finalizePendingCandidate(actor, pending.candidateId);
    assert.equal(letter.leavingLetterId.length > 0, true);
    assert.equal(letter.secureFileId, pending.secureFileId);
  } finally {
    await database.close();
  }
});
