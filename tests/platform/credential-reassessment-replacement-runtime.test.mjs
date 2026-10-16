import assert from "node:assert/strict";
import test from "node:test";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { acceptedReassessmentSource } from "../helpers/assessment-appeal-reassessment-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
const KEY="reassessment-test-signing-secret-more-than-32";

test("Actual positive issuer finalizes only the explicitly associated accepted reassessment and retains old signed history",async()=>{
 const fixture=await assessmentFundingFixture({policyValues:{pass_mark:70,credentialValidityDays:60}});
 const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
 try{
  const x=await acceptedReassessmentSource(fixture,database);
  const {CredentialIssuanceRepository}=loadTs("src/lib/credential/credential-issuance-repository.ts"),credentials=new CredentialIssuanceRepository(Promise.resolve(database));
  const original=await credentials.findPublic(x.appeal.credentialId);
  const appealHistory=(await database.query("SELECT * FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[x.appeal.appealId])).rows;
  const application=await x.service.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId,x.now,{sourceAppealId:x.appeal.appealId});
  const fresh=await x.service.confirmSandboxWorkerPayment(fixture.worker,application.applicationId,x.now);
  // Completed review prerequisites are fixture inputs. Final decision/storage/replacement are actual producers.
  await database.query("UPDATE assurance_cases SET case_status='Decision pending',owner_kind='admin' WHERE case_id=$1",[fresh.caseId]);
  const {createDecision}=loadTs("src/lib/decision/decision-engine-domain.ts"),{DecisionRepository}=loadTs("src/lib/decision/decision-engine-repository.ts");
  const issuedAt=new Date(x.now.getTime()+1000).toISOString();
  const decision=createDecision({tenantId:x.oldCase.tenant_id,caseId:fresh.caseId,state:"APPROVED",reasonCode:"reassessment_passed",explanation:"The explicitly linked reassessment meets the pinned rule.",ruleVersion:"reassessment-test",inputReferences:[application.applicationId,x.appeal.appealId],createdAt:issuedAt});
  await new DecisionRepository(Promise.resolve(database),KEY).saveDecisionAndProgressCase(decision,fixture.credentials.admin.accountId);
  const links=(await database.query("SELECT * FROM credential_replacements WHERE appeal_id=$1",[x.appeal.appealId])).rows;
  assert.equal(links.length,1,"Original positive issuer must finalize the explicit reassessment replacement association.");
  const link=links[0];assert.equal(link.disposition,"REPLACED");assert.equal(link.old_case_id,x.oldCase.case_id);assert.equal(link.new_case_id,fresh.caseId);
  assert.equal(link.old_credential_id,original.credentialId);assert.equal(link.tenant_id,x.oldCase.tenant_id);assert.equal(link.worker_id,original.workerId);
  const replacement=await credentials.findPublic(link.new_credential_id);assert.notEqual(replacement.credentialId,original.credentialId);
  assert.equal(replacement.issuedAt,issuedAt);assert.equal(new Date(replacement.expiresAt).getTime()-new Date(issuedAt).getTime(),60*86400000);
  const {credentialAuthentication}=loadTs("src/lib/credential/credential-issuance-domain.ts");assert.equal(credentialAuthentication(replacement,KEY),"authenticated");
  const retained=await credentials.findPublic(original.credentialId);assert.equal(retained.status,"revoked");
  for(const field of ["issuedAt","expiresAt","signature","qrPayload"])assert.equal(retained[field],original[field]);
  assert.deepEqual((await database.query("SELECT * FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[x.appeal.appealId])).rows,appealHistory);
  const {LivingRecordRepository}=loadTs("src/lib/living-record/living-record-repository.ts"),records=await new LivingRecordRepository(Promise.resolve(database)).findByWorker(original.workerId);
  assert.deepEqual(records.find(r=>r.sourceCredentialId===original.credentialId).versions.map(v=>v.status),["valid","reassessment_required","revoked"]);
  assert.equal(records.find(r=>r.sourceCredentialId===replacement.credentialId).versions.at(-1).status,"valid");
  await assert.rejects(new DecisionRepository(Promise.resolve(database),KEY).saveDecisionAndProgressCase(decision,fixture.credentials.admin.accountId),/ready|conflict/i);
  assert.equal((await database.query("SELECT count(*) AS n FROM credential_replacements WHERE appeal_id=$1",[x.appeal.appealId])).rows[0].n,1);
 }finally{await database.close();await fixture.cleanup();}
});


test("Explicit reassessment issuer rejects owner review, lost Company access, missing validity and unauthenticated original without partial replacement",async()=>{
 for(const kind of ["owner","inactive_link","unspecified","unknown_key"]){
  const fixture=await assessmentFundingFixture({policyValues:kind==="unspecified"?{pass_mark:70}:{pass_mark:70,credentialValidityDays:60}});
  const database=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
  try{
   const x=await acceptedReassessmentSource(fixture,database);
   const application=await x.service.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId,x.now,{sourceAppealId:x.appeal.appealId});
   const fresh=await x.service.confirmSandboxWorkerPayment(fixture.worker,application.applicationId,x.now);
   await database.query("UPDATE assurance_cases SET case_status='Decision pending',owner_kind='admin' WHERE case_id=$1",[fresh.caseId]);
   if(kind==="inactive_link")await database.query("UPDATE company_worker_links SET link_status='revoked',revoked_at=NOW() WHERE link_id=$1",[fixture.fundingInput.workerLinkId]);
   const {createDecision}=loadTs("src/lib/decision/decision-engine-domain.ts"),{DecisionRepository}=loadTs("src/lib/decision/decision-engine-repository.ts");
   const decision=createDecision({tenantId:x.oldCase.tenant_id,caseId:fresh.caseId,state:"APPROVED",reasonCode:"reassessment_passed",explanation:"Controlled explicitly associated reassessment.",ruleVersion:"reassessment-test",inputReferences:[application.applicationId,x.appeal.appealId],createdAt:new Date(x.now.getTime()+1000).toISOString()});
   await assert.rejects(new DecisionRepository(Promise.resolve(database),kind==="unknown_key"?KEY+"-unretained":KEY).saveDecisionAndProgressCase(decision,kind==="owner"?fixture.worker.accountId:fixture.credentials.admin.accountId),/independent|unavailable|validity|authentication|ownership/i);
   assert.equal((await database.query("SELECT count(*) AS n FROM credential_replacements")).rows[0].n,0);
   assert.equal((await database.query("SELECT count(*) AS n FROM credential_issuances")).rows[0].n,1);
   assert.equal((await database.query("SELECT count(*) AS n FROM platform_decisions WHERE case_id=$1",[fresh.caseId])).rows[0].n,0);
   assert.equal((await database.query("SELECT case_status,credential_reference FROM assurance_cases WHERE case_id=$1",[fresh.caseId])).rows[0].case_status,"Decision pending");
   assert.equal((await database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[fresh.caseId])).rows[0].credential_reference,null);
   assert.equal((await database.query("SELECT status FROM credential_issuances WHERE credential_id=$1",[x.appeal.credentialId])).rows[0].status,"valid");
   assert.equal((await database.query("SELECT status FROM living_record_versions version JOIN living_record_competencies competency USING(competency_id) WHERE source_credential_id=$1 ORDER BY version DESC LIMIT 1",[x.appeal.credentialId])).rows[0].status,"reassessment_required");
  }finally{await database.close();await fixture.cleanup();}
 }
});
