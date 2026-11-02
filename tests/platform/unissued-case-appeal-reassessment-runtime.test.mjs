import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {assessmentFundingFixture,fundingPrincipal} from "../helpers/assessment-funding-fixture.mjs";
import {completeFundedCaseObjectiveAssessment} from "../helpers/completed-funded-assessment-fixture.mjs";
import {seedPublishedQuestion} from "../helpers/question-publication-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const {CaseAppealService}=loadWorkerRegistrationTs("src/lib/assurance/case-appeal-service.ts");
const {DecisionRepository}=loadWorkerRegistrationTs("src/lib/decision/decision-engine-repository.ts");
const {createDecision}=loadWorkerRegistrationTs("src/lib/decision/decision-engine-domain.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const hash=(text)=>createHash("sha256").update(text).digest("hex");

test("Accepted independent unissued-case appeal creates a new policy-scoped paid assessment without losing source",{timeout:120000},async()=>{
 const f=await assessmentFundingFixture(),database=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
 try{
  const now=new Date(),service=new WorkerAssessmentApplicationService(database);
  const request=await service.requestCompanyFunding(f.worker,f.fundingInput,now);
  await service.decideCompanyFunding(f.company,{fundingRequestId:request.fundingRequestId,approved:true,now});
  const original=(await database.query("SELECT cases.* FROM assurance_cases cases JOIN worker_assessment_applications applications ON applications.assurance_case_id=cases.case_id WHERE applications.application_id=$1",[request.applicationId])).rows[0];
  await completeFundedCaseObjectiveAssessment(database,original.case_id,now);
  const decision=createDecision({tenantId:original.tenant_id,caseId:original.case_id,state:"REJECTED",
    reasonCode:"competency_not_demonstrated",explanation:"Retained competency evidence does not demonstrate the required controls.",
    ruleVersion:"m21303-case-appeal-v1",inputReferences:[original.assessment_reference??original.case_id],createdAt:now.toISOString()});
  await new DecisionRepository(Promise.resolve(database),"case-appeal-test-signing-key-2026").saveDecisionAndProgressCase(decision,f.credentials.admin.accountId);
  const appealService=new CaseAppealService(Promise.resolve(database));
  const appeal=await appealService.submit(f.worker,{caseId:original.case_id,grounds:"Retained assessed evidence requires a new independent challenge and reassessment."});
  const reviewerId="case_appeal_native_independent_admin";
  await database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'case-appeal-native-admin@example.test','Independent appeal Admin','active','test-unused',$2,$2,$2,$2)",[reviewerId,now.toISOString()]);
  await database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[reviewerId,now.toISOString()]);
  const reviewer=await fundingPrincipal(database,{accountId:reviewerId},"admin");
  const repo=new AuthAccessRepository(database);
  await repo.authentication.insertSecurityEvent({eventId:"case-appeal-native-mfa",accountId:reviewer.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:new Date().toISOString()});
  await repo.authentication.insertSecurityEvent({eventId:"case-appeal-native-login",accountId:reviewer.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:reviewer.sessionId,mfaEventId:"case-appeal-native-mfa"},occurredAt:new Date().toISOString()});
  const accepted=await appealService.review(reviewer,{appealId:appeal.appealId,version:1,status:"accepted",reason:"Independent review accepts the challenge; policy-scoped reassessment is required."});
  assert.equal(accepted.status,"accepted");
  const framework=(await database.query("SELECT framework_id FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[f.fundingInput.catalogueVersionId])).rows[0].framework_id;
  const alt="case-appeal-reassessment-alternate";
  await seedPublishedQuestion(database,{questionId:"assessment_question_"+hash(alt).slice(0,24),versionId:"question_version_"+hash(alt+"-version").slice(0,24),
    reference:"CASE-APPEAL-REASSESSMENT-ALT",questionType:"MULTIPLE_CHOICE",
    prompt:"Which action is correct when hazardous isolation is incomplete?",
    options:["Stop and isolate","Continue without controls"],answerKey:"Stop and isolate",frameworkId:framework,
    fingerprint:hash(alt+"-fingerprint"),authorAccountId:f.credentials.admin.accountId,now:new Date().toISOString()});
  const offerings=await service.listCaseAppealReassessmentOfferings(f.worker,accepted.appealId);
  assert.ok(offerings.some(x=>x.catalogueVersionId===f.fundingInput.catalogueVersionId&&x.eligibilityStatus==="AVAILABLE"),
    "The accepted original-scope assessment must become eligible without bypassing the pinned policy");
  const paid=await service.applyWorkerPay(f.worker,f.fundingInput.catalogueVersionId,new Date(),{sourceCaseAppealId:accepted.appealId});
  assert.equal(paid.sourceCaseAppealId,accepted.appealId);
  const source=(await database.query("SELECT * FROM worker_case_appeal_reassessment_sources WHERE application_id=$1",[paid.applicationId])).rows[0];
  assert.equal(source.source_case_id,original.case_id);
  assert.equal(source.source_decision_id,decision.decisionId);
  assert.equal(source.source_case_appeal_id,accepted.appealId);
  assert.equal(source.worker_account_id,f.worker.accountId);
  await assert.rejects(database.query("UPDATE worker_case_appeal_reassessment_sources SET source_case_id='forged_case' WHERE application_id=$1",[paid.applicationId]),/immutable/i);
  const funded=await service.confirmSandboxWorkerPayment(f.worker,paid.applicationId,new Date());
  assert.notEqual(funded.caseId,original.case_id);
  const fresh=(await database.query("SELECT case_status,tenant_id,worker_account_id,permanent_worker_id,worker_link_id FROM assurance_cases WHERE case_id=$1",[funded.caseId])).rows[0];
  assert.equal(fresh.tenant_id,original.tenant_id);assert.equal(fresh.worker_account_id,original.worker_account_id);
  assert.equal(fresh.permanent_worker_id,original.permanent_worker_id);
  assert.equal(fresh.worker_link_id,source.worker_link_id);
  const latest=(await database.query("SELECT case_status,decision_reference FROM assurance_cases WHERE case_id=$1",[original.case_id])).rows[0];
  assert.equal(latest.case_status,"Rejected");assert.equal(latest.decision_reference,decision.decisionId);
  await assert.rejects(service.applyWorkerPay(f.worker,f.fundingInput.catalogueVersionId,new Date(),{sourceCaseAppealId:"case_appeal_"+"x".repeat(24)}),/unavailable/i);
  await assert.rejects(database.exec(readFileSync("database/migrations/0131_unissued_case_appeal_reassessment.down.sql","utf8")) ,/lineage must be retained/i);
  await assert.rejects(database.exec(readFileSync("database/migrations/0130_unissued_case_appeals.down.sql","utf8")) ,/histories must be retained/i);
  console.log("M21303_LINKED_REASSESSMENT: accepted independent case appeal -> immutable source -> paid fresh same-tenant same-worker same-framework case");
 }finally{await database.close();await f.cleanup();}
});
