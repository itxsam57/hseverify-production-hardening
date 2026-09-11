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
const { WorkerEvidenceConflictError } = domainModule;
const { WorkerEvidenceService } = serviceModule;

const OWNED_MIGRATION = "0030_worker_evidence_records";
const NOW = "2026-08-17T06:20:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-11-lifecycle",
  sessionSecret: "m1-11-lifecycle-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m1-11-lifecycle-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function principal(character) {
  return Object.freeze({
    sessionId: `session_m111_lifecycle_${character}`,
    accountId: `account_m111_lifecycle_${character}`,
    activeRole: "worker",
    accountStatus: "active",
    email: `lifecycle-${character.toLowerCase()}@example.com`,
    displayName: `Lifecycle Worker ${character}`,
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

test("M1.11 ended employment cannot be ended again or reopened through a revision", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, OWNED_MIGRATION);
    const actor = principal("E");
    await seedAuditActor(database, actor);
    const service = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));

    const draft = await service.createDraft(actor, "employment");
    const saved = await service.saveEmploymentDraft(actor, {
      recordId: draft.recordId,
      expectedRevision: draft.currentVersion.revision,
      companyName: "Nesma & Partners",
      roleTitle: "Safety Officer",
      duties: "Safety inspections",
      country: "Saudi Arabia",
      startDate: "2024-01-01",
      endDate: null,
      status: "current",
      endReason: null
    });
    const submitted = await service.submit(actor, saved.recordId, saved.currentVersion.revision);
    const ended = await service.endEmployment(
      actor,
      submitted.recordId,
      submitted.currentVersion.revision,
      "2026-08-01",
      "Assignment completed"
    );
    assert.equal(ended.lifecycleStatus, "ended");

    await assert.rejects(
      service.endEmployment(
        actor,
        ended.recordId,
        ended.currentVersion.revision,
        "2026-08-02",
        "Second end attempt"
      ),
      WorkerEvidenceConflictError
    );
    await assert.rejects(
      service.startRevision(actor, ended.recordId, ended.currentVersion.revision),
      WorkerEvidenceConflictError
    );
  } finally {
    await database.close();
  }
});

test("M1.11 inactive skill cannot be inactivated again or reopened through a revision", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "m1-11-skill-lifecycle" });
  try {
    await applyMigrationsThrough(database, "m1-11-skill-lifecycle", OWNED_MIGRATION);
    const actor = principal("S");
    await seedAuditActor(database, actor);
    const service = new WorkerEvidenceService(Promise.resolve(database), () => new Date(NOW));

    const draft = await service.createDraft(actor, "skill");
    const saved = await service.saveSkillDraft(actor, {
      recordId: draft.recordId,
      expectedRevision: draft.currentVersion.revision,
      skillName: "Permit to Work",
      category: "Safety systems",
      proficiencyClaim: "Advanced",
      experienceMonths: 36,
      relatedTrade: "HSE"
    });
    const submitted = await service.submit(actor, saved.recordId, saved.currentVersion.revision);
    const inactive = await service.markSkillInactive(
      actor,
      submitted.recordId,
      submitted.currentVersion.revision
    );
    assert.equal(inactive.lifecycleStatus, "inactive");

    await assert.rejects(
      service.markSkillInactive(
        actor,
        inactive.recordId,
        inactive.currentVersion.revision
      ),
      WorkerEvidenceConflictError
    );
    await assert.rejects(
      service.startRevision(actor, inactive.recordId, inactive.currentVersion.revision),
      WorkerEvidenceConflictError
    );
  } finally {
    await database.close();
  }
});
