import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";

import { acceptedReassessmentSource as source } from "../helpers/assessment-appeal-reassessment-fixture.mjs";
test("Actual accepted reassessment explicitly binds the Worker-paid application and fresh same-scope case without changing original appeal history",async()=>{
 const fixture=await assessmentFundingFixture(),database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try {
  const x=await source(fixture,database);
  const before=(await database.query("SELECT * FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[x.appeal.appealId])).rows;
  const application=await x.service.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId,x.now,{sourceAppealId:x.appeal.appealId});
  assert.equal(application.sourceAppealId,x.appeal.appealId,"Original Worker application must retain the explicitly chosen accepted reassessment appeal.");
  const fresh=await x.service.confirmSandboxWorkerPayment(fixture.worker,application.applicationId,x.now);
  const association=(await database.query("SELECT * FROM worker_assessment_reassessment_sources WHERE application_id=$1",[application.applicationId])).rows[0];
  assert.equal(association.source_appeal_id,x.appeal.appealId);assert.equal(Number(association.source_appeal_version),x.appeal.version);
  assert.equal(association.source_case_id,x.oldCase.case_id);
  const created=(await database.query("SELECT tenant_id,worker_account_id,permanent_worker_id,case_status FROM assurance_cases WHERE case_id=$1",[fresh.caseId])).rows[0];
  assert.equal(created.tenant_id,x.oldCase.tenant_id);assert.equal(created.worker_account_id,fixture.worker.accountId);
  assert.equal(created.permanent_worker_id,x.oldCase.permanent_worker_id);assert.equal(created.case_status,"Assessment pending");
  assert.notEqual(fresh.caseId,x.oldCase.case_id);
  assert.equal((await database.query("SELECT framework_id FROM assurance_case_policy_snapshots WHERE case_id=$1",[fresh.caseId])).rows[0].framework_id,association.source_framework_id);
  assert.deepEqual((await database.query("SELECT * FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[x.appeal.appealId])).rows,before);
  await assert.rejects(database.query("UPDATE worker_assessment_reassessment_sources SET source_appeal_version=99 WHERE application_id=$1",[application.applicationId]),/immutable|append-only/i);
  await assert.rejects(database.execute(readFileSync("database/migrations/0101_assessment_reassessment_sources.down.sql","utf8")),/retain|history/i,"Populated rollback must retain the explicit original appeal/case lineage.");
  assert.equal((await database.query("SELECT count(*) AS n FROM worker_assessment_reassessment_sources WHERE application_id=$1",[application.applicationId])).rows[0].n,1);

 } finally {await database.close();await fixture.cleanup();}
});

test("Explicit reassessment denies unknown/foreign scope and rechecks live Company link before funding without changing retained application history",async()=>{
 const fixture=await assessmentFundingFixture(),database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const x=await source(fixture,database);
  const {resolveAssessmentReassessmentSource}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/assessment-reassessment-source-service.ts");
  const count=async()=>Number((await database.query("SELECT count(*) AS n FROM worker_assessment_applications")).rows[0].n);
  const originalCount=await count();
  await assert.rejects(x.service.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId,x.now,{sourceAppealId:"appeal_unknown"}),/selected reassessment appeal is unavailable/i);
  for(const wrong of [{workerAccountId:"search_foreign_worker"},{permanentWorkerId:"HSE-WORKER-FOREIGN"},{frameworkId:"framework_foreign"}])
   await assert.rejects(resolveAssessmentReassessmentSource(database,{sourceAppealId:x.appeal.appealId,workerAccountId:fixture.worker.accountId,permanentWorkerId:x.oldCase.permanent_worker_id,...wrong}),/selected reassessment appeal is unavailable/i);
  assert.equal(await count(),originalCount);
  const application=await x.service.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId,x.now,{sourceAppealId:x.appeal.appealId});
  const before=(await database.query("SELECT * FROM worker_assessment_application_events WHERE application_id=$1 ORDER BY occurred_at,event_id",[application.applicationId])).rows;
  await database.query( "UPDATE company_worker_links SET link_status='revoked',revoked_at=$2 WHERE link_id=$1",[fixture.fundingInput.workerLinkId,x.now.toISOString()]);
  await assert.rejects(x.service.confirmSandboxWorkerPayment(fixture.worker,application.applicationId,x.now),/selected reassessment appeal is unavailable/i);
  const retained=(await database.query("SELECT application_status,funded_at,assurance_case_id FROM worker_assessment_applications WHERE application_id=$1",[application.applicationId])).rows[0];
  assert.deepEqual(retained,{application_status:"PAYMENT_REQUIRED",funded_at:null,assurance_case_id:null});
  assert.deepEqual((await database.query("SELECT * FROM worker_assessment_application_events WHERE application_id=$1 ORDER BY occurred_at,event_id",[application.applicationId])).rows,before);
  assert.equal((await database.query("SELECT count(*) AS n FROM worker_assessment_reassessment_sources WHERE application_id=$1",[application.applicationId])).rows[0].n,1);
 }finally{await database.close();await fixture.cleanup();}
});
test("Ordinary self-payment remains independent and does not automatically associate an accepted reassessment appeal",async()=>{
 const fixture=await assessmentFundingFixture(),database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const x=await source(fixture,database),application=await x.service.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId,x.now);
  assert.equal(application.sourceAppealId,null);
  const fresh=await x.service.confirmSandboxWorkerPayment(fixture.worker,application.applicationId,x.now);
  assert.equal((await database.query("SELECT tenant_id FROM assurance_cases WHERE case_id=$1",[fresh.caseId])).rows[0].tenant_id,"tenant_independent_worker_scope");
  assert.equal((await database.query("SELECT count(*) AS n FROM worker_assessment_reassessment_sources")).rows[0].n,0);
  assert.equal((await database.query("SELECT status,outcome_action FROM credential_appeals WHERE appeal_id=$1",[x.appeal.appealId])).rows[0].outcome_action,"reassessment");
 }finally{await database.close();await fixture.cleanup();}
});
test("Empty reassessment-source rollback and reapply preserve existing ordinary applications",async()=>{
 const fixture=await assessmentFundingFixture(),database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const before=(await database.query("SELECT * FROM worker_assessment_applications ORDER BY application_id")).rows;
  await database.execute(readFileSync("database/migrations/0101_assessment_reassessment_sources.down.sql","utf8"));
  assert.equal((await database.query("SELECT to_regclass('worker_assessment_reassessment_sources') AS table_ref")).rows[0].table_ref,null);
  await database.execute(readFileSync("database/migrations/0101_assessment_reassessment_sources.up.sql","utf8"));
  assert.equal((await database.query("SELECT count(*) AS n FROM worker_assessment_reassessment_sources")).rows[0].n,0);
  assert.deepEqual((await database.query("SELECT * FROM worker_assessment_applications ORDER BY application_id")).rows,before);
 }finally{await database.close();await fixture.cleanup();}
});
