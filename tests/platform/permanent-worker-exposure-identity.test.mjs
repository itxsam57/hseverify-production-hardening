import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {assessmentFundingFixture} from "../helpers/assessment-funding-fixture.mjs";
import {reportAddWorkerPrincipal} from "../helpers/report-company-fixture.mjs";
import {seedPermanentWorkerId} from "../helpers/permanent-worker-id-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {AssessmentFormGenerationService,hasUnseenAssessmentCapacity}=loadWorkerRegistrationTs("src/lib/assessment-generation/assessment-form-generation-service.ts");
const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");

test("permanent Worker ID owns immutable question exposure, not a caller-chosen account key",{timeout:120000},async()=>{
 const fixture=await assessmentFundingFixture({startingCreditUnits:0});
 const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const applications=new WorkerAssessmentApplicationService(db);
  const app=await applications.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId);
  const funded=await applications.confirmSandboxWorkerPayment(fixture.worker,app.applicationId);
  const caseRow=(await db.query("SELECT c.case_id,c.worker_account_id,s.framework_id,s.blueprint_version_id FROM assurance_cases c JOIN assessment_catalogue_versions s ON s.catalogue_version_id=$1 WHERE c.case_id=$2",[fixture.fundingInput.catalogueVersionId,funded.caseId])).rows[0];
  const permanent=(await db.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",[fixture.worker.accountId])).rows[0].permanent_worker_id;
  assert.match(permanent,/^worker_id_/);
  const generator=new AssessmentFormGenerationService(db);
  const form=await generator.generateForCase(fixture.worker,{caseId:funded.caseId,blueprintVersionId:caseRow.blueprint_version_id});
  const owner=(await db.query("SELECT worker_account_id,permanent_worker_id FROM generated_assessment_forms WHERE form_id=$1",[form.formId])).rows[0];
  assert.equal(owner.worker_account_id,fixture.worker.accountId);
  assert.equal(owner.permanent_worker_id,permanent,"Persistent assessment form must bind permanent Worker ID.");
  const items=(await db.query("SELECT permanent_worker_id,exposure_family_reference FROM generated_assessment_form_items WHERE form_id=$1",[form.formId])).rows;
  assert.equal(items.length,1);
  assert.equal(items[0].permanent_worker_id,permanent,"Items must derive Worker ID from immutable parent form, not client input.");
  assert.equal(await hasUnseenAssessmentCapacity(db,{workerAccountId:fixture.worker.accountId,blueprintVersionId:caseRow.blueprint_version_id,frameworkId:caseRow.framework_id}),false);
  // A caller cannot claim a different Worker ID to obtain a fresh question.
  const spoofed="worker_id_"+"z".repeat(24);
  await assert.rejects(db.query("UPDATE generated_assessment_form_items SET permanent_worker_id=$1 WHERE form_id=$2",[spoofed,form.formId]),
   /append-only/i,"Exposed question history must be append-only.");
  const family=items[0].exposure_family_reference;
  const unique=(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE indexname='generated_assessment_form_items_worker_id_family_uq'")).rows[0];
  assert.ok(unique);
  assert.match(unique.indexdef,/UNIQUE/i);
  assert.match(unique.indexdef,/permanent_worker_id.*exposure_family_reference/i);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM generated_assessment_form_items WHERE permanent_worker_id=$1 AND exposure_family_reference=$2",[permanent,family])).rows[0].n,1);
 }finally{await db.close();await fixture.cleanup();}
});


test("0126 reversible backfill preserves already exposed immutable question history",{timeout:120000},async()=>{
 const fixture=await assessmentFundingFixture({startingCreditUnits:0});
 const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const applications=new WorkerAssessmentApplicationService(db);
  const application=await applications.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId);
  const funded=await applications.confirmSandboxWorkerPayment(fixture.worker,application.applicationId);
  const blueprint=(await db.query("SELECT blueprint_version_id FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[fixture.fundingInput.catalogueVersionId])).rows[0].blueprint_version_id;
  const form=await new AssessmentFormGenerationService(db).generateForCase(fixture.worker,{caseId:funded.caseId,blueprintVersionId:blueprint});
  const before=(await db.query("SELECT permanent_worker_id FROM generated_assessment_forms WHERE form_id=$1",[form.formId])).rows[0].permanent_worker_id;
  const original=(await db.query("SELECT question_id,exposure_family_reference FROM generated_assessment_form_items WHERE form_id=$1",[form.formId])).rows;
  assert.equal(original.length,1);
  const down=readFileSync("database/migrations/0126_permanent_worker_exposure_identity.down.sql","utf8");
  await db.exec(down);
  const oldColumns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='generated_assessment_forms' AND column_name='permanent_worker_id'")).rows;
  assert.equal(oldColumns.length,0);
  assert.deepEqual((await db.query("SELECT question_id,exposure_family_reference FROM generated_assessment_form_items WHERE form_id=$1",[form.formId])).rows,original,"Rollback cannot delete or modify exposed question history.");
  const up=readFileSync("database/migrations/0126_permanent_worker_exposure_identity.up.sql","utf8");
  await db.exec(up);
  assert.equal((await db.query("SELECT permanent_worker_id FROM generated_assessment_forms WHERE form_id=$1",[form.formId])).rows[0].permanent_worker_id,before);
  assert.equal((await db.query("SELECT permanent_worker_id FROM generated_assessment_form_items WHERE form_id=$1",[form.formId])).rows[0].permanent_worker_id,before);
  assert.deepEqual((await db.query("SELECT question_id,exposure_family_reference FROM generated_assessment_form_items WHERE form_id=$1",[form.formId])).rows,original);
  await assert.rejects(
   db.query("UPDATE generated_assessment_forms SET permanent_worker_id=NULL WHERE form_id=$1",[form.formId]),
   /append-only/i,"Immutable append-only history must be restored after data backfill.");
  const indexes=(await db.query("SELECT indexname FROM pg_indexes WHERE indexname='generated_assessment_form_items_worker_id_family_uq'")).rows;
  assert.equal(indexes.length,1);
 }finally{await db.close();await fixture.cleanup();}
});


test("two separately issued permanent Worker IDs have separate Exposure Family histories without an account merge",{timeout:120000},async()=>{
 const fixture=await assessmentFundingFixture({startingCreditUnits:0});
 const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const secondWorker=await reportAddWorkerPrincipal({...fixture,database:db});
  const secondWorkerId=await seedPermanentWorkerId(db,secondWorker,"q",new Date().toISOString());
  const firstWorkerId=(await db.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",[fixture.worker.accountId])).rows[0].permanent_worker_id;
  assert.notEqual(firstWorkerId,secondWorkerId);
  assert.notEqual(secondWorker.accountId,fixture.worker.accountId);
  const applications=new WorkerAssessmentApplicationService(db);
  const catalogueId=fixture.fundingInput.catalogueVersionId;
  const first=await applications.applyWorkerPay(fixture.worker,catalogueId);
  const firstFunded=await applications.confirmSandboxWorkerPayment(fixture.worker,first.applicationId);
  const second=await applications.applyWorkerPay(secondWorker,catalogueId);
  const secondFunded=await applications.confirmSandboxWorkerPayment(secondWorker,second.applicationId);
  const blueprint=(await db.query("SELECT blueprint_version_id FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[catalogueId])).rows[0].blueprint_version_id;
  const generate=new AssessmentFormGenerationService(db);
  const formA=await generate.generateForCase(fixture.worker,{caseId:firstFunded.caseId,blueprintVersionId:blueprint});
  const formB=await generate.generateForCase(secondWorker,{caseId:secondFunded.caseId,blueprintVersionId:blueprint});
  assert.equal(formA.items.length,1);
  assert.equal(formB.items.length,1);
  assert.equal(formA.items[0].questionId,formB.items[0].questionId,
   "Independent verified Workers may receive a question another person saw.");
  const stored=(await db.query("SELECT permanent_worker_id,worker_account_id,exposure_family_reference FROM generated_assessment_form_items WHERE form_id=ANY($1::text[]) ORDER BY permanent_worker_id",[[formA.formId,formB.formId]])).rows;
  assert.equal(stored.length,2);
  assert.deepEqual(stored.map(x=>x.permanent_worker_id).sort(),[firstWorkerId,secondWorkerId].sort());
  assert.deepEqual(new Set(stored.map(x=>x.worker_account_id)).size,2);
  assert.equal(new Set(stored.map(x=>x.exposure_family_reference)).size,1);
  const framework=(await db.query("SELECT framework_id FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[catalogueId])).rows[0].framework_id;
  for(const accountId of [fixture.worker.accountId,secondWorker.accountId]){
   assert.equal(await hasUnseenAssessmentCapacity(db,{workerAccountId:accountId,blueprintVersionId:blueprint,frameworkId:framework}),false,
    "Each permanent Worker ID must independently exhaust its own exposed family.");
  }
 }finally{await db.close();await fixture.cleanup();}
});
