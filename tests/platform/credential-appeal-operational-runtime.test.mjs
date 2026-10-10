import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "credential-appeal-operational-runtime",
  sessionSecret: "credential-appeal-operational-session-secret-more-than-32",
  authPepper: "credential-appeal-operational-auth-pepper-more-than-32",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};


async function loadAppealStack() {
  return {
    service: loadTs("src/lib/credential/credential-appeals-service.ts"),
    appealsRepository: loadTs("src/lib/credential/credential-appeals-repository.ts"),
    credentialRepository: loadTs("src/lib/credential/credential-issuance-repository.ts"),
    livingRepository: loadTs("src/lib/living-record/living-record-repository.ts"),
    livingDomain: loadTs("src/lib/living-record/living-record-domain.ts")
  };
}

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(
    db,
    ENV.releaseSha,
    "0074_credential_appeal_operational_workflow"
  );
  return db;
}

test("accepted credential appeal preserves reasoned review history and appends a Living Record reassessment version", async () => {
  const db = await database();
  const stack = await loadAppealStack();
  const { CredentialAppealsService } = stack.service;
  const { CredentialAppealsRepository } = stack.appealsRepository;
  const { LivingRecordRepository } = stack.livingRepository;
  const { createLivingCompetencyRecord } = stack.livingDomain;
  try {
    const workerId = "worker_id_" + "w".repeat(24);
    const credentialId = "credential_id_" + "c".repeat(24);
    const now = "2026-10-02T00:00:00.000Z";

    await db.query(
      `INSERT INTO credential_issuances(
         credential_id,worker_id,qualification,issued_at,expires_at,status,version,
         public_status_url,qr_payload,signature,pdf_url
       ) VALUES($1,$2,'HSE Operational Assurance',$3,NULL,'valid',1,$4,$5,$6,$7)`,
      [
        credentialId,
        workerId,
        now,
        "/verify/result/" + credentialId,
        JSON.stringify({ credentialId }),
        "a".repeat(64),
        "/api/credentials/" + credentialId + "/pdf"
      ]
    );
    await db.query(
      "INSERT INTO credential_lifecycle_events(credential_id,status,version,changed_at) VALUES($1,'valid',1,$2)",
      [credentialId, now]
    );

    const living = new LivingRecordRepository(Promise.resolve(db));
    await living.replaceCompetencyRecord(
      workerId,
      createLivingCompetencyRecord({
        competencyId: "competency_" + "x".repeat(24),
        title: "HSE Operational Assurance",
        sourceCredentialId: credentialId,
        initial: {
          status: "valid",
          effectiveAt: now,
          expiresAt: null,
          restrictions: [],
          conditions: [],
          reassessment: { required: false, dueAt: null, reason: null }
        }
      })
    );

    const service = new CredentialAppealsService(Promise.resolve(db));
    const submitted = await service.submit({
      credentialId,
      workerId,
      reason: "The credential should be reviewed because the retained evidence was interpreted incorrectly.",
      evidence: ["worker_evidence_record_appeal_01"],
      createdAt: "2026-10-02T01:00:00.000Z"
    }, "operational_runtime_01");
    assert.equal(submitted.status, "submitted");

    await assert.rejects(
      service.submit({
        credentialId,
        workerId,
        reason: "Duplicate open appeal should be blocked.",
        createdAt: "2026-10-02T01:01:00.000Z"
      }, "operational_runtime_02"),
      /already open/i
    );

    const underReview = await service.reviewOutcome(submitted, {
      status: "under_review",
      reviewerId: "account_admin_reviewer_01",
      reason: "Independent review started against the retained evidence and original credential history.",
      outcomeAction: "none",
      reviewedAt: "2026-10-02T02:00:00.000Z"
    });
    assert.equal(underReview.appeal.status, "under_review");

    const accepted = await service.reviewOutcome(underReview.appeal, {
      status: "accepted",
      reviewerId: "account_admin_reviewer_01",
      reason: "Appeal accepted. The competency must be reassessed before the Living Record returns to valid.",
      outcomeAction: "reassessment",
      reviewedAt: "2026-10-02T03:00:00.000Z"
    });
    assert.equal(accepted.appeal.status, "accepted");
    assert.equal(accepted.livingRecordAction, "reassessment_required");
    assert.equal(accepted.livingRecordVersionsAdded, 1);

    const stored = await new CredentialAppealsRepository(Promise.resolve(db)).find(submitted.appealId);
    assert.equal(stored?.reviewerAccountId, "account_admin_reviewer_01");
    assert.match(stored?.reviewReason ?? "", /reassessed/i);
    assert.equal(stored?.outcomeAction, "reassessment");
    assert.equal(stored?.version, 3);

    const records = await living.findByCredential(credentialId);
    assert.equal(records.length, 1);
    assert.equal(records[0].versions.length, 2);
    assert.equal(records[0].versions[0].status, "valid");
    assert.equal(records[0].versions[1].status, "reassessment_required");
    assert.equal(records[0].versions[1].reassessment.required, true);
    assert.match(records[0].versions[1].reassessment.reason ?? "", /Appeal accepted/);

    const events = await db.query(
      `SELECT version,status,reviewer_account_id,review_reason,outcome_action
         FROM credential_appeal_events
        WHERE appeal_id=$1
        ORDER BY version`,
      [submitted.appealId]
    );
    assert.deepEqual(events.rows.map((row) => row.status), ["submitted", "under_review", "accepted"]);
    assert.equal(events.rows[2].reviewer_account_id, "account_admin_reviewer_01");
    assert.equal(events.rows[2].outcome_action, "reassessment");
    await assert.rejects(
      db.query(
        "UPDATE credential_appeal_events SET review_reason='tampered' WHERE appeal_id=$1 AND version=3",
        [submitted.appealId]
      ),
      /append-only/i
    );
  } finally {
    await db.close();
  }
});

test("accepted appeal can apply an explicit credential lifecycle action and mirror it into Living Record history", async () => {
  const db = await database();
  const stack = await loadAppealStack();
  const { CredentialAppealsService } = stack.service;
  const { CredentialIssuanceRepository } = stack.credentialRepository;
  const { LivingRecordRepository } = stack.livingRepository;
  const { createLivingCompetencyRecord } = stack.livingDomain;
  try {
    const workerId = "worker_id_" + "y".repeat(24);
    const credentialId = "credential_id_" + "d".repeat(24);
    const now = "2026-10-02T00:00:00.000Z";
    const credentials = new CredentialIssuanceRepository(Promise.resolve(db));

    await db.query(
      `INSERT INTO credential_issuances(
         credential_id,worker_id,qualification,issued_at,expires_at,status,version,
         public_status_url,qr_payload,signature,pdf_url
       ) VALUES($1,$2,'HSE Lifecycle Assurance',$3,NULL,'valid',1,$4,$5,$6,$7)`,
      [
        credentialId,
        workerId,
        now,
        "/verify/result/" + credentialId,
        JSON.stringify({ credentialId }),
        "b".repeat(64),
        "/api/credentials/" + credentialId + "/pdf"
      ]
    );
    await db.query(
      "INSERT INTO credential_lifecycle_events(credential_id,status,version,changed_at) VALUES($1,'valid',1,$2)",
      [credentialId, now]
    );
    const living = new LivingRecordRepository(Promise.resolve(db));
    await living.replaceCompetencyRecord(
      workerId,
      createLivingCompetencyRecord({
        competencyId: "competency_" + "z".repeat(24),
        title: "HSE Lifecycle Assurance",
        sourceCredentialId: credentialId,
        initial: {
          status: "valid",
          effectiveAt: now,
          expiresAt: null,
          restrictions: [],
          conditions: [],
          reassessment: { required: false, dueAt: null, reason: null }
        }
      })
    );

    const service = new CredentialAppealsService(Promise.resolve(db));
    const appeal = await service.submit({
      credentialId,
      workerId,
      reason: "The current credential should be suspended while corrected evidence is reviewed.",
      createdAt: "2026-10-02T01:00:00.000Z"
    }, "operational_runtime_03");

    const outcome = await service.reviewOutcome(appeal, {
      status: "accepted",
      reviewerId: "account_admin_reviewer_02",
      reason: "Appeal accepted and the credential is suspended until the corrected evidence is resolved.",
      outcomeAction: "suspend",
      reviewedAt: "2026-10-02T02:00:00.000Z"
    });
    assert.equal(outcome.credentialAction, "suspend");
    const credential = await credentials.findPublic(credentialId);
    assert.equal(credential?.status, "suspended");
    assert.equal(credential?.version, 2);
    const records = await living.findByCredential(credentialId);
    assert.equal(records[0].versions.at(-1)?.status, "suspended");
  } finally {
    await db.close();
  }
});