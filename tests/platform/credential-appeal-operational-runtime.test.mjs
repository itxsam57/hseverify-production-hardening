import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

import { credentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

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
  const fixture = await credentialDecisionFixture({qualification:"HSE Operational Assurance"});
  const db = fixture.database, at = "2026-09-25T11:00:00.127Z";
  await applyMigrationsThrough(db, fixture.environment.releaseSha, "0074_credential_appeal_operational_workflow");
  for (const id of ["original_decision_admin", "account_admin_reviewer_01", "account_admin_reviewer_02"]) {
    await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,'Independent test admin','active','test-only',$3,$3,$3,$3)", [id,id+"@example.test",at]);
    await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[id,at]);
  }
  await fixture.repo.saveDecisionAndProgressCase(fixture.decision,"original_decision_admin");
  const credentialId=(await db.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[fixture.caseId])).rows[0].credential_reference;
  return {db,credentialId,workerId:"worker_id_validity_000001"};
}

test("accepted credential appeal preserves reasoned review history and appends a Living Record reassessment version", async () => {
  const {db,credentialId,workerId} = await database();
  const stack = await loadAppealStack();
  const { CredentialAppealsService } = stack.service;
  const { CredentialAppealsRepository } = stack.appealsRepository;
  const { LivingRecordRepository } = stack.livingRepository;
  try {
    const living = new LivingRecordRepository(Promise.resolve(db));

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
  const {db,credentialId,workerId} = await database();
  const stack = await loadAppealStack();
  const { CredentialAppealsService } = stack.service;
  const { CredentialIssuanceRepository } = stack.credentialRepository;
  const { LivingRecordRepository } = stack.livingRepository;
  try {
    const living = new LivingRecordRepository(Promise.resolve(db));
    const credentials = new CredentialIssuanceRepository(Promise.resolve(db));

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