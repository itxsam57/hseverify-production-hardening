import assert from "node:assert/strict";
import test from "node:test";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { acceptedReassessmentSource } from "../helpers/assessment-appeal-reassessment-fixture.mjs";
import { completeFundedCaseObjectiveAssessment } from "../helpers/completed-funded-assessment-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

test("replacement rechecks its source after a newer appeal review commits", { timeout: 60000 }, async () => {
  const path = await realpath(process.env.HSE_SOFTWARE_STAGE_CONFIG);
  const stage = JSON.parse(await readFile(path, "utf8"));
  assert.equal(stage.syntheticOnly, true);
  assert.equal(dirname(path), stage.privateRoot);
  assert.ok(stage.privateRoot.startsWith(resolve(stage.projectRoot, "..") + "/hse-https-stage."));
  const databaseUrl = stage.applicationEnvironment.DATABASE_URL;
  assert.equal(new URL(databaseUrl).hostname, "127.0.0.1");
  const options = { databaseDriver: "postgres", databaseUrl };
  const fixture = await assessmentFundingFixture({ stage, policyValues: { pass_mark: 70, credentialValidityDays: 60 } });
  const database = await openScriptDatabase(options);
  const reviewClient = await openScriptDatabase(options);
  const replacementClient = await openScriptDatabase(options);
  const key = "reassessment-test-signing-secret-more-than-32";
  let releaseReview;
  const reviewGate = new Promise(resolveGate => { releaseReview = resolveGate; });
  let reviewRun, replacementRun;
  try {
    const source = await acceptedReassessmentSource(fixture, database);
    const application = await source.service.applyWorkerPay(fixture.worker, fixture.fundingInput.catalogueVersionId, source.now, { sourceAppealId: source.appeal.appealId });
    const fresh = await source.service.confirmSandboxWorkerPayment(fixture.worker, application.applicationId, source.now);
    await completeFundedCaseObjectiveAssessment(database, fresh.caseId, source.now);

    const { CredentialAppealsService } = loadTs("src/lib/credential/credential-appeals-service.ts");
    const { DecisionRepository } = loadTs("src/lib/decision/decision-engine-repository.ts");
    const { createDecision } = loadTs("src/lib/decision/decision-engine-domain.ts");
    const appeals = new CredentialAppealsService(Promise.resolve(database), key);
    const competing = await appeals.submit({
      credentialId: source.appeal.credentialId,
      workerId: source.appeal.workerId,
      reason: "A subsequent independent review supersedes the original reassessment.",
      createdAt: new Date(source.now.getTime() + 1000).toISOString()
    }, "replacement_race");
    const decision = createDecision({
      tenantId: source.oldCase.tenant_id, caseId: fresh.caseId, state: "APPROVED",
      reasonCode: "reassessment_passed", explanation: "A completed reassessment awaiting source revalidation.",
      ruleVersion: "reassessment-race", inputReferences: [application.applicationId],
      createdAt: new Date(source.now.getTime() + 3000).toISOString()
    });
    let reviewReady;
    const ready = new Promise(resolveReady => { reviewReady = resolveReady; });
    let reviewPid, replacementPid;
    reviewRun = new CredentialAppealsService(Promise.resolve({
      transaction: operation => reviewClient.transaction(async tx => {
        reviewPid = (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        const result = await operation(tx);
        reviewReady();
        await reviewGate;
        return result;
      })
    }), key).reviewOutcome(competing, {
      status: "accepted", outcomeAction: "none", reviewerId: source.appeal.reviewerAccountId,
      reason: "Newer independent review completed without another credential action.",
      reviewedAt: new Date(source.now.getTime() + 2000).toISOString()
    });
    await Promise.race([ready, reviewRun]);
    replacementRun = new DecisionRepository(Promise.resolve({
      transaction: operation => replacementClient.transaction(async tx => {
        await tx.execute("SET LOCAL lock_timeout='10s'");
        replacementPid = (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        return operation(tx);
      })
    }), key).saveDecisionAndProgressCase(decision, fixture.credentials.admin.accountId);
    const replacementResult = replacementRun.then(value => ({ value }), error => ({ error }));
    let blocked = false;
    for (let attempt = 0; attempt < 50 && !blocked; attempt++) {
      if (replacementPid) blocked = (await database.query("SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked", [replacementPid, reviewPid])).rows[0].blocked;
      if (!blocked) await delay(100);
    }
    assert.ok(blocked, "The replacement must actually wait on the concurrent review");
    releaseReview();
    await reviewRun;
    const result = await replacementResult;
    assert.match(result.error?.message ?? "", /selected reassessment appeal is unavailable/i);
    assert.equal(Number((await database.query("SELECT count(*) AS n FROM credential_replacements")).rows[0].n), 0);
    const current = (await database.query("SELECT case_status,credential_reference FROM assurance_cases WHERE case_id=$1", [fresh.caseId])).rows[0];
    assert.equal(current.case_status, "Decision pending");
    assert.equal(current.credential_reference, null);
    assert.equal(Number((await database.query("SELECT count(*) AS n FROM platform_decisions WHERE case_id=$1", [fresh.caseId])).rows[0].n), 0);
    const credentials = (await database.query("SELECT credential_id,status FROM credential_issuances")).rows;
    assert.deepEqual(credentials, [{ credential_id: source.appeal.credentialId, status: "valid" }]);
    const updatedAppeal = (await database.query("SELECT status,outcome_action FROM credential_appeals WHERE appeal_id=$1", [competing.appealId])).rows[0];
    assert.deepEqual(updatedAppeal, { status: "accepted", outcome_action: "none" });

  } finally {
    releaseReview();
    await Promise.allSettled([reviewRun, replacementRun]);
    await Promise.all([database.close(), reviewClient.close(), replacementClient.close(), fixture.cleanup()]);
  }
});
