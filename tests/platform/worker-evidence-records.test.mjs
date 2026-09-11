import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_WORKER_EVIDENCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_WORKER_EVIDENCE_RUNTIME_DIST is required");

const domainModule = await import(
  pathToFileURL(join(runtime, "worker-evidence", "worker-evidence-domain.js")).href
);
const serviceModule = await import(
  pathToFileURL(join(runtime, "worker-evidence", "worker-evidence-service.js")).href
);

const {
  WorkerEvidenceConflictError,
  WorkerEvidenceNotFoundError
} = domainModule;
const { WorkerEvidenceService } = serviceModule;

const OWNED_MIGRATION = "0030_worker_evidence_records";
const NOW = "2026-08-17T01:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-worker-evidence-service",
  sessionSecret: "m1-11-service-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-service-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function principal(character) {
  return Object.freeze({
    sessionId: `session_m111_${character}`,
    accountId: `account_m111_${character}`,
    activeRole: "worker",
    accountStatus: "active",
    email: `worker-${character.toLowerCase()}@example.com`,
    displayName: `Worker ${character}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE,
    tenantMembership: null
  });
}

function qualificationInput(recordId, revision, title = "NEBOSH IGC") {
  return Object.freeze({
    recordId,
    expectedRevision: revision,
    title,
    category: "Occupational Health and Safety",
    issuingOrganization: "NEBOSH",
    learningProvider: "Approved Learning Partner",
    certificateNumber: "CERT-M111-001",
    issueDate: "2024-01-10",
    expiryDate: "2029-01-10",
    level: "Level 3",
    country: "United Kingdom",
    verificationUrl: "https://example.test/qualification",
    declarationAccepted: true
  });
}

function skillInput(recordId, revision, name = "Permit to Work") {
  return Object.freeze({
    recordId,
    expectedRevision: revision,
    skillName: name,
    category: "Safety systems",
    proficiencyClaim: "Advanced",
    experienceMonths: 36,
    relatedTrade: "HSE"
  });
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

test("M1.11 Worker evidence service derives ownership from the Worker principal and does not enumerate copied record IDs", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);
    const workerA = principal("A");
    await seedAuditActor(database, workerA);
    const workerB = principal("B");
    await seedAuditActor(database, workerB);
    const service = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));

    const draft = await service.createDraft(workerA, "qualification");
    assert.equal(draft.workerAccountId, workerA.accountId);
    assert.equal(draft.kind, "qualification");
    assert.equal(draft.currentVersion.status, "draft");
    assert.equal(draft.currentVersion.versionNumber, 1);
    assert.equal(draft.currentVersion.revision, 1);

    const saved = await service.saveQualificationDraft(
      workerA,
      qualificationInput(draft.recordId, draft.currentVersion.revision)
    );
    assert.equal(saved.currentVersion.revision, 2);
    assert.equal(saved.currentVersion.details.title, "NEBOSH IGC");

    await assert.rejects(
      service.findCurrent(workerB, draft.recordId),
      WorkerEvidenceNotFoundError
    );
    await assert.rejects(
      service.findCurrent(workerB, "evidence_record_missing_m111"),
      WorkerEvidenceNotFoundError
    );
    await assert.rejects(
      service.saveQualificationDraft(
        workerB,
        qualificationInput(draft.recordId, saved.currentVersion.revision, "Copied")
      ),
      WorkerEvidenceNotFoundError
    );
  } finally {
    await database.close();
  }
});

test("M1.11 draft revision prevents stale browser saves from overwriting newer metadata", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-stale-draft" });
  try {
    await applyMigrationsThrough(database, "m1-11-stale-draft", OWNED_MIGRATION);
    const worker = principal("C");
    await seedAuditActor(database, worker);
    const service = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const draft = await service.createDraft(worker, "qualification");

    const first = await service.saveQualificationDraft(
      worker,
      qualificationInput(draft.recordId, 1, "First saved title")
    );
    assert.equal(first.currentVersion.revision, 2);

    await assert.rejects(
      service.saveQualificationDraft(
        worker,
        qualificationInput(draft.recordId, 1, "Stale overwrite")
      ),
      WorkerEvidenceConflictError
    );

    const current = await service.findCurrent(worker, draft.recordId);
    assert.equal(current.currentVersion.details.title, "First saved title");
    assert.equal(current.currentVersion.revision, 2);
  } finally {
    await database.close();
  }
});

test("M1.11 submitted skill versions are immutable and revisions preserve submitted history", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-version-history" });
  try {
    await applyMigrationsThrough(database, "m1-11-version-history", OWNED_MIGRATION);
    const worker = principal("D");
    await seedAuditActor(database, worker);
    const service = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));
    const draft = await service.createDraft(worker, "skill");
    const saved = await service.saveSkillDraft(
      worker,
      skillInput(draft.recordId, 1, "Confined Space Entry")
    );
    assert.equal(saved.currentVersion.details.assuranceStatus, "self_declared");

    const submitted = await service.submit(
      worker,
      draft.recordId,
      saved.currentVersion.revision
    );
    assert.equal(submitted.currentVersion.status, "submitted");
    assert.ok(submitted.currentVersion.submittedAt);

    await assert.rejects(
      service.saveSkillDraft(
        worker,
        skillInput(draft.recordId, submitted.currentVersion.revision, "Mutated submitted skill")
      ),
      WorkerEvidenceConflictError
    );

    const revision = await service.startRevision(
      worker,
      draft.recordId,
      submitted.currentVersion.revision
    );
    assert.equal(revision.currentVersion.status, "draft");
    assert.equal(revision.currentVersion.versionNumber, 2);
    assert.equal(revision.currentVersion.revision, 1);
    assert.equal(revision.currentVersion.details.skillName, "Confined Space Entry");
    assert.equal(revision.currentVersion.details.assuranceStatus, "self_declared");

    const history = await service.listVersions(worker, draft.recordId);
    assert.equal(history.length, 2);
    const versionOne = history.find((version) => version.versionNumber === 1);
    const versionTwo = history.find((version) => version.versionNumber === 2);
    assert.equal(versionOne?.status, "submitted");
    assert.equal(versionOne?.details.skillName, "Confined Space Entry");
    assert.equal(versionTwo?.status, "draft");
  } finally {
    await database.close();
  }
});

test("M1.11 Worker evidence service exposes history transitions but no destructive record delete API", async () => {
  const servicePrototype = WorkerEvidenceService.prototype;
  assert.equal(typeof servicePrototype.createDraft, "function");
  assert.equal(typeof servicePrototype.startRevision, "function");
  assert.equal(typeof servicePrototype.endEmployment, "function");
  assert.equal(typeof servicePrototype.markSkillInactive, "function");
  assert.equal(typeof servicePrototype.deleteRecord, "undefined");
  assert.equal(typeof servicePrototype.deleteEvidence, "undefined");
});
