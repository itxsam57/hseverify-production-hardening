import assert from "node:assert/strict";
import test from "node:test";
import { assessmentEligibilityWaitingFixture } from "../helpers/assessment-eligibility-policy-fixture.mjs";
import { seedEligibilityTradeEvidence, produceEligibilityTradeSkill, assessmentEligibilityTradeFixture } from "../helpers/assessment-eligibility-trade-fixture.mjs";
import { fundingPrincipal, assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const {EffectivePolicyService}=loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const {WorkerEvidenceService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");

test("Published verified trade requirement denies an old generic approval of the exact skill version",async()=>{
 const terminalAt=new Date(),now=new Date(terminalAt.getTime()+5000);
 const fixture=await assessmentEligibilityWaitingFixture({waitingPeriodDays:0,attemptLimit:2,terminalAt,policyEffectiveTo:now});
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const evidence=new WorkerEvidenceService(Promise.resolve(database),()=>now);
  const draft=await evidence.createDraft(fixture.worker,"skill");
  const saved=await evidence.saveSkillDraft(fixture.worker,{recordId:draft.recordId,expectedRevision:draft.currentVersion.revision,
   skillName:"Isolation safety",category:"Safety",proficiencyClaim:"Practised",experienceMonths:24,relatedTrade:"Electrical"});
  await seedEligibilityTradeEvidence(database,fixture.worker,saved,now);
  const submitted=await evidence.submit(fixture.worker,saved.recordId,saved.currentVersion.revision);
  const reviews=new EvidenceReviewService(database),task=await reviews.queueIndependentWorkerEvidence(fixture.worker,saved.recordId,now);
  const verifier=await fundingPrincipal(database,fixture.credentials.verifier,"verifier");
  await reviews.claim(verifier,task.taskId,now);
  await reviews.decide(verifier,task.taskId,"APPROVED","Evidence was approved without separate trade confirmation.",now);
  assert.equal(submitted.currentVersion.details.assuranceStatus,"self_declared");
  await new EffectivePolicyService(database).publishPolicyVersion(fixture.admin,{frameworkReference:"SEARCH-WORKER",policyReference:"ELIGIBILITY-POLICY",
   title:"Explicit evidence verified trade gate",effectiveFrom:now,effectiveTo:null,
   policyValues:{pass_mark:70,assessmentEligibility:{verifiedTrades:["Electrical"]}},overrideAllowedFields:[],overrideDirections:{}},now);
  const applications=new WorkerAssessmentApplicationService(database);
  const offering=(await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.catalogue);
  assert.equal(offering.eligibilityStatus,"TRADE_REQUIRED","A generic approval must not retroactively assert that trade mapping was verified");
  await assert.rejects(()=>applications.applyWorkerPay(fixture.worker,fixture.catalogue,now),/trade/i);
 }finally{await database.close();await fixture.cleanup();}
});

test("Explicit original Verifier confirmation authorizes all configured producer paths and preserves provenance through later context loss",async()=>{
 const fixture=await assessmentEligibilityTradeFixture(),now=new Date();
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const applications=new WorkerAssessmentApplicationService(database);
  const {AssuranceOrderService}=loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");
  const {AssessmentCatalogueEligibilityService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/assessment-catalogue-eligibility-service.ts");
  const {AssessmentAttemptService}=loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");
  const orders=new AssuranceOrderService(database),company={...fixture.company,authorizedTenantPermission:"company.orders.manage"};
  const status=async()=>(await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.tradeCatalogue).eligibilityStatus;
  assert.equal(await status(),"TRADE_REQUIRED");
  await assert.rejects(()=>applications.requestCompanyFunding(fixture.worker,{...fixture.fundingInput,catalogueVersionId:fixture.tradeCatalogue},now),/trade/i);
  await assert.rejects(()=>orders.submitOrder(company,fixture.draft.orderId,now),/trade/i);
  const reviews=new EvidenceReviewService(database),verifier=await fundingPrincipal(database,fixture.credentials.verifier,"verifier");
  await reviews.claim(verifier,fixture.tradeTaskId,now);
  const context=await reviews.findAssignedSkill(verifier,fixture.tradeTaskId);
  assert.equal(context.relatedTrade,"Electrical");assert.equal(context.evidenceAvailable,true);
  await reviews.decide(verifier,fixture.tradeTaskId,"APPROVED","Electrical trade mapping verified against this exact submitted evidence.",now,{confirmTrade:true});
  const decision=(await database.query("SELECT * FROM evidence_review_decisions WHERE task_id=$1",[fixture.tradeTaskId])).rows[0];
  assert.equal(decision.verified_trade,"Electrical");assert.equal(decision.verification_method,"evidence_review");
  assert.equal(decision.verification_source_file_id,fixture.tradeFileId);assert.equal(decision.source_version_id,fixture.tradeVersionId);
  assert.equal(decision.verifier_account_id,verifier.accountId);assert.equal(await status(),"AVAILABLE");
  assert.equal((await orders.validateOrder(company,fixture.draft.orderId,now)).ready,true);
  await orders.submitOrder(company,fixture.draft.orderId,now);
  const application=await applications.applyWorkerPay(fixture.worker,fixture.tradeCatalogue,now);
  const funded=await applications.confirmSandboxWorkerPayment(fixture.worker,application.applicationId,now);
  const sourceCase=(await database.query("SELECT case_id FROM assurance_cases WHERE order_id=$1",[fixture.draft.orderId])).rows[0].case_id;
  const pins=(await database.query("SELECT snapshot_id,effective_value_json FROM assurance_case_policy_snapshots WHERE case_id IN ($1,$2)",[sourceCase,funded.caseId])).rows;
  assert.equal(pins.length,2);for(const pin of pins)assert.deepEqual(pin.effective_value_json.assessmentEligibility,{verifiedTrades:["Electrical"]});
  await assert.rejects(()=>database.query("UPDATE evidence_review_decisions SET verified_trade='Other' WHERE decision_id=$1",[decision.decision_id]),/append-only|immutable/i);
  const before=(await database.query("SELECT attempt_id,status FROM assessment_attempts ORDER BY attempt_id")).rows;
  // A current draft cannot reuse the prior exact submitted version's explicit approval.
  const evidence=new WorkerEvidenceService(Promise.resolve(database),()=>now);
  const record=(await database.query("SELECT record_id,revision FROM worker_evidence_versions WHERE version_id=$1",[fixture.tradeVersionId])).rows[0];
  await evidence.startRevision(fixture.worker,record.record_id,record.revision);
  assert.equal(await status(),"TRADE_REQUIRED");
  assert.equal((await new AssessmentCatalogueEligibilityService(database).listUnavailableForWorker(fixture.worker,now)).find(row=>row.caseId===funded.caseId).eligibilityStatus,"TRADE_REQUIRED");
  await assert.rejects(()=>new AssessmentAttemptService(database).begin(fixture.worker,{caseId:funded.caseId,catalogueVersionId:fixture.tradeCatalogue},now),{name:"AssessmentAttemptAccessError"});
  assert.deepEqual((await database.query("SELECT attempt_id,status FROM assessment_attempts ORDER BY attempt_id")).rows,before);
  assert.deepEqual((await database.query("SELECT * FROM evidence_review_decisions WHERE decision_id=$1",[decision.decision_id])).rows[0],decision);
  const {readFile}=await import("node:fs/promises");
  await assert.rejects(async()=>database.execute(await readFile("database/migrations/0102_explicit_verified_trade.down.sql","utf8")),/retained|history/i);
 }finally{await database.close();await fixture.cleanup();}
});

test("Configured trade policy prevents rollback before any mapped decision; a truly unused feature rolls back and reapplies without altering old generic reviews",async()=>{
 const {readFile}=await import("node:fs/promises"),down=await readFile("database/migrations/0102_explicit_verified_trade.down.sql","utf8"),up=await readFile("database/migrations/0102_explicit_verified_trade.up.sql","utf8");
 const fixture=await assessmentEligibilityTradeFixture();
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try {
  assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM evidence_review_decisions WHERE verified_trade IS NOT NULL")).rows[0].n,0);
  const history=(await database.query("SELECT policy_version_id,policy_values FROM assurance_policy_versions ORDER BY policy_version_id")).rows;
  await assert.rejects(()=>database.execute(down),/retained configured trade policy history/i);
  assert.equal((await new WorkerAssessmentApplicationService(database).listOfferings(fixture.worker,new Date())).find(row=>row.catalogueVersionId===fixture.tradeCatalogue).eligibilityStatus,"TRADE_REQUIRED");
  assert.deepEqual((await database.query("SELECT policy_version_id,policy_values FROM assurance_policy_versions ORDER BY policy_version_id")).rows,history);
 }finally{await database.close();await fixture.cleanup();}
 const empty=await assessmentFundingFixture(),db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:empty.environment.HSE_PGLITE_DATA_DIR});
 try {
  const now=new Date(),generic=await produceEligibilityTradeSkill(db,empty,now,{approve:true});
  const before=(await db.query("SELECT decision_id,task_id,source_version_id,outcome,reason FROM evidence_review_decisions ORDER BY decision_id")).rows;
  await db.execute(down);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name='evidence_review_decisions' AND column_name='verified_trade'")).rows[0].n,0);
  await produceEligibilityTradeSkill(db,empty,now,{approve:true});
  await db.execute(up);
  assert.deepEqual((await db.query("SELECT decision_id,task_id,source_version_id,outcome,reason FROM evidence_review_decisions WHERE task_id=$1",[generic.task.taskId])).rows,before);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM evidence_review_decisions WHERE verified_trade IS NOT NULL")).rows[0].n,0);
  await produceEligibilityTradeSkill(db,empty,now,{approve:true,confirmTrade:true});
  await assert.rejects(()=>db.execute(down),/retained explicit trade verification history/i);
 }finally{await db.close();await empty.cleanup();}
});
