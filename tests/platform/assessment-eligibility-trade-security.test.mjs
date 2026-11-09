import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { assessmentEligibilityTradeFixture, produceEligibilityTradeSkill } from "../helpers/assessment-eligibility-trade-fixture.mjs";
import { fundingPrincipal } from "../helpers/assessment-funding-fixture.mjs";
import { authorizeReviewFixture } from "../helpers/evidence-review-calibration-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const {WorkerEvidenceService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const {normalizeAssessmentEligibilityPolicyFields}=loadWorkerRegistrationTs("src/lib/policy/assessment-eligibility-policy-domain.ts");

test("Explicit trade confirmation rejects forged ownership, assignment, source and type while source loss immediately removes optional availability",async()=>{
 const fixture=await assessmentEligibilityTradeFixture(),now=new Date();
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try {
  const reviews=new EvidenceReviewService(database),verifier=await fundingPrincipal(database,fixture.credentials.verifier,"verifier");
  await reviews.claim(verifier,fixture.tradeTaskId,now);
  for(const verifiedTrades of [[],[" "],["Electrical","electrical"],["x".repeat(161)],"Electrical",["Electrical",1]]) {
   assert.throws(()=>normalizeAssessmentEligibilityPolicyFields({assessmentEligibility:{verifiedTrades}}),{name:"AssessmentEligibilityPolicyInputError"});
  }
  await assert.rejects(()=>reviews.decide(verifier,fixture.tradeTaskId,"APPROVED","Explicit confirmation cannot accept a string.",now,{confirmTrade:"true"}),{name:"EvidenceReviewInputError"});
  await assert.rejects(()=>reviews.decide(verifier,fixture.tradeTaskId,"REJECTED","A rejection cannot also verify a trade mapping.",now,{confirmTrade:true}),/explicit trade/i);
  await assert.rejects(()=>reviews.findAssignedSkill(fixture.worker,fixture.tradeTaskId),{name:"EvidenceReviewAccessError"});
  await database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[fixture.credentials.admin.accountId]);
  const foreign=await fundingPrincipal(database,fixture.credentials.admin,"verifier");
  await assert.rejects(()=>reviews.findAssignedSkill(foreign,fixture.tradeTaskId),{name:"EvidenceReviewAccessError"});
  await assert.rejects(()=>reviews.decide(foreign,fixture.tradeTaskId,"APPROVED","Foreign assignee must not confirm the owned task.",now,{confirmTrade:true}),{name:"EvidenceReviewAccessError"});
  const sql=`INSERT INTO evidence_review_decisions(decision_id,task_id,source_version_id,verifier_account_id,outcome,reason,decided_at,
    verified_trade,verification_method,verification_source_file_id) VALUES($1,$2,$3,$4,'APPROVED',$5,$6,$7,$8,$9)`;
  const forged=(label,changes={})=>{
   const values=["review_decision_"+createHash("sha256").update(label).digest("hex").slice(0,24),
    fixture.tradeTaskId,fixture.tradeVersionId,verifier.accountId,"Forged confirmation must be rejected by the original SQL boundary.",now.toISOString(),"Electrical","evidence_review",fixture.tradeFileId];
   for(const [index,value] of Object.entries(changes))values[Number(index)]=value;
   return database.query(sql,values);
  };
  const another=await produceEligibilityTradeSkill(database,fixture,now,{relatedTrade:"Plumbing"});
  for(const [label,changes] of [["trade",{6:"Plumbing"}],["source",{8:another.fileId}],["actor",{3:foreign.accountId}],
    ["version",{2:another.submitted.currentVersion.versionId}],["method",{7:null}]]) {
   await assert.rejects(()=>forged(label,changes),/trade|check|source|constraint/i);
  }
  assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM evidence_review_decisions WHERE task_id=$1",[fixture.tradeTaskId])).rows[0].n,0);
  // A Worker with a valid separate Verifier role still cannot verify their own trade evidence.
  await database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[fixture.worker.accountId]);
  const self=await fundingPrincipal(database,fixture.credentials.worker,"verifier");
  await authorizeReviewFixture(database,{taskId:another.task.taskId,verifiers:[self],at:now});
  await assert.rejects(()=>reviews.claim(self,another.task.taskId,now),{name:"EvidenceReviewAccessError"});
  await assert.rejects(()=>reviews.findAssignedSkill(self,another.task.taskId),{name:"EvidenceReviewAccessError"});
  await assert.rejects(()=>reviews.decide(self,another.task.taskId,"APPROVED","Self review must not establish verified trade authority.",now,{confirmTrade:true}),{name:"EvidenceReviewAccessError"});
  const stale=await produceEligibilityTradeSkill(database,fixture,now);
  await reviews.claim(verifier,stale.task.taskId,now);
  await stale.evidence.startRevision(fixture.worker,stale.submitted.recordId,stale.submitted.currentVersion.revision);
  await assert.rejects(()=>reviews.decide(verifier,stale.task.taskId,"APPROVED","A stale submitted version must not verify a current trade.",now,{confirmTrade:true}),/stale|changed/i);
  await reviews.decide(verifier,fixture.tradeTaskId,"APPROVED","Exact submitted Electrical mapping verified against this evidence.",now,{confirmTrade:true,verifiedTrade:"Plumbing",verificationSourceFileId:another.fileId});
  const saved=(await database.query("SELECT * FROM evidence_review_decisions WHERE task_id=$1",[fixture.tradeTaskId])).rows[0];
  assert.equal(saved.verified_trade,"Electrical");assert.equal(saved.verification_source_file_id,fixture.tradeFileId);
  const applications=new WorkerAssessmentApplicationService(database);
  const status=async()=>(await applications.listOfferings(fixture.worker,now)).find(row=>row.catalogueVersionId===fixture.tradeCatalogue).eligibilityStatus;
  assert.equal(await status(),"AVAILABLE");
  const current=(await database.query("SELECT record_id,revision FROM worker_evidence_versions WHERE version_id=$1",[fixture.tradeVersionId])).rows[0];
  await new WorkerEvidenceService(Promise.resolve(database),()=>now).markSkillInactive(fixture.worker,current.record_id,current.revision);
  assert.equal(await status(),"TRADE_REQUIRED");
  await assert.rejects(()=>applications.applyWorkerPay(fixture.worker,fixture.tradeCatalogue,now),/trade/i);
  assert.deepEqual((await database.query("SELECT * FROM evidence_review_decisions WHERE decision_id=$1",[saved.decision_id])).rows[0],saved);
 }finally{await database.close();await fixture.cleanup();}
});
