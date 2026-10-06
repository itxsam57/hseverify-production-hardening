import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "privacy-consent-accommodation-runtime",
  sessionSecret: "privacy-consent-accommodation-session-secret-more-than-32-characters",
  authPepper: "privacy-consent-accommodation-auth-pepper-more-than-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const NOW = "2026-10-01T00:00:00.123Z";

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(
    db,
    ENV.releaseSha,
    "0078_privacy_request_review_history"
  );
  return db;
}

import { loadTs as realTs } from "../../scripts/interview-test-ts-loader.mjs";
const {collectWorkerPrivacyData}=realTs("src/lib/privacy/worker-privacy-data.ts");
test("privacy data uses real schemas, isolates owners, and excludes auth/share secrets", async()=>{
 const db=await database();
 try {
  for(const [id,email,ref] of [['privacy_export_owner','owner-export@example.test','ref_export_owner'],['privacy_export_other','other-export@example.test','ref_export_other']]){
   await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,worker_reference,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$1,'active','PRIVATE_PASSWORD_HASH_SENTINEL',$3,$4,$4,$4,$4)",[id,email,ref,NOW]);
   await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[id,NOW]);
   await db.query("INSERT INTO privacy_requests(request_id,worker_id,request_type,details) VALUES($1,$2,'access','{}')",['request_'+id,id]);
   await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES($1,$2,'[]','Owned export share',$3,$4)",['share_'+id,ref,NOW,'PRIVATE_NONCE_SENTINEL'.padEnd(64,'n')]);
  }
  for (const id of ['privacy_export_owner','privacy_export_other']) {
   await db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES($1,$2,'qualification','active',NULL,$3,$3)",['record_'+id,id,NOW]);
   await db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,created_at,updated_at) VALUES($1,$2,1,1,'draft',$3,$3)",['version_'+id,'record_'+id,NOW]);
   await db.query("INSERT INTO worker_qualification_versions(version_id,declaration_accepted) VALUES($1,false)",['version_'+id]);
   await db.query("UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1",['record_'+id,'version_'+id]);
  }
  const data=await collectWorkerPrivacyData(db,'privacy_export_owner',NOW);
  assert.equal(data.evidence.length,1);
  assert.equal(data.evidence[0].recordId,'record_privacy_export_owner');
  assert.equal(data.evidence[0].versions.length,1);
  assert.equal(data.evidence[0].versions[0].versionId,'version_privacy_export_owner');
  assert.equal(data.account.account_id,'privacy_export_owner');
  assert.deepEqual(data.privacyRequests.map(r=>r.request_id),['request_privacy_export_owner']);
  assert.deepEqual(data.shareLinks.map(r=>r.share_link_id),['share_privacy_export_owner']);
  for(const forbidden of ['PRIVATE_PASSWORD_HASH_SENTINEL','PRIVATE_NONCE_SENTINEL','other-export@example.test','privacy_export_other','password_hash','token_nonce_hash'])
   assert.equal(JSON.stringify(data).includes(forbidden),false,forbidden);
  await assert.rejects(collectWorkerPrivacyData(db,'unknown_owner',NOW),/unavailable/);
  assert.equal((await db.query("SELECT count(*) AS total FROM privacy_requests")).rows[0].total,2);
 } finally {await db.close();}
});

import {seedInProgressAttempt,seedWorkerPrincipal,stableId} from "../helpers/assessment-attempt-fixture.mjs";
test("current personal data includes latest owned assessment answer revisions and retains original history",async()=>{
 const db=await database();
 try {
  let ownerId;
  for(const suffix of ['export-answer-owner','export-answer-other']){
   const principal=await seedWorkerPrincipal(db,suffix);
   const fixture=await seedInProgressAttempt(db,principal,suffix,[{questionType:'LONG_TEXT'}]);
   const item=fixture.items[0],answerId=stableId('assessment_answer',suffix);
   await db.query("INSERT INTO assessment_attempt_answers(answer_id,attempt_id,form_id,form_item_id,position,question_id,question_version_id,question_type,text_value,committed_at) VALUES($1,$2,$3,$4,1,$5,$6,'LONG_TEXT',$7,$8)",[answerId,fixture.attemptId,fixture.formId,item.formItemId,item.questionId,item.questionVersionId,'original-'+suffix,NOW]);
   for(const revision of [1,2])
    await db.query("INSERT INTO assessment_answer_revisions(revision_id,attempt_id,answer_id,position,revision_no,text_value,revised_at) VALUES($1,$2,$3,1,$4,$5,$6)",[stableId('assessment_revision',suffix+'-'+revision),fixture.attemptId,answerId,revision,'revised-'+revision+'-'+suffix,NOW]);
   if(suffix==='export-answer-owner'){
    ownerId=principal.accountId;
    const data=await collectWorkerPrivacyData(db,principal.accountId,NOW);
    assert.equal(data.assessmentAnswers.length,1);
    assert.equal(data.assessmentAnswers[0].text_value,'original-export-answer-owner');
    assert.equal(data.assessmentAnswers[0].current_text_value,'revised-2-export-answer-owner');
    assert.equal(data.assessmentAnswers[0].current_revision_no,2);
    assert.deepEqual(data.assessmentAnswerRevisions.map(r=>r.revision_no),[1,2]);
   } else {
    const data=await collectWorkerPrivacyData(db,ownerId,NOW);
    assert.equal(data.assessmentAnswers.length,1);
    assert.equal(data.assessmentAnswerRevisions.length,2);
    assert.equal(JSON.stringify(data).includes('export-answer-other'),false);
   }
  }
 } finally {await db.close();}
});

const {PrivacyOperationsRepository}=realTs("src/lib/privacy/privacy-operations-repository.ts");
test("access fulfilment prepares an owner-only download before recording COMPLETED",async()=>{
 const db=await database();
 try {
  for(const [id,role] of [['privacy_access_red_owner','worker'],['privacy_access_red_admin','admin']]){
   await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$1,'active','fixture',$3,$3,$3,$3)",[id,id+'@example.test',NOW]);
   await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[id,role,NOW]);
  }
  const repository=new PrivacyOperationsRepository(Promise.resolve(db));
  await repository.createRequest({requestId:'privacy_access_red',workerId:'privacy_access_red_owner',tenantId:null,type:'access'});
  const result=await repository.reviewRequest({requestId:'privacy_access_red',reviewerAccountId:'privacy_access_red_admin',reviewId:'privacy_access_red_review',expectedStatus:'OPEN',decision:'COMPLETED',reason:'Prepare this Worker own personal data download.',now:NOW});
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.details.fulfilment.method,'owned_current_data_download');
  const own=await repository.downloadWorkerData('privacy_access_red','privacy_access_red_owner',NOW);
  assert.equal(own.account.account_id,'privacy_access_red_owner');
  await assert.rejects(repository.downloadWorkerData('privacy_access_red','privacy_access_red_admin',NOW),/unavailable/);
  await repository.createRequest({requestId:'privacy_open_fake',workerId:'privacy_access_red_owner',tenantId:null,type:'export',details:{fulfilment:{method:'owned_current_data_download'}}});
  await assert.rejects(repository.downloadWorkerData('privacy_open_fake','privacy_access_red_owner',NOW),/unavailable/);
  await repository.createRequest({requestId:'privacy_rollback_export',workerId:'privacy_access_red_owner',tenantId:null,type:'export'});
  await assert.rejects(repository.reviewRequest({requestId:'privacy_rollback_export',reviewerAccountId:'missing_reviewer',reviewId:'privacy_rollback_review',expectedStatus:'OPEN',decision:'COMPLETED',reason:'Required history failure must roll back delivery.',now:NOW}));
  const rollback=(await db.query("SELECT status,details,completed_at FROM privacy_requests WHERE request_id='privacy_rollback_export'")).rows[0];
  assert.equal(rollback.status,'OPEN');assert.equal(rollback.completed_at,null);assert.equal(rollback.details.fulfilment,undefined);
  await assert.rejects(repository.downloadWorkerData('privacy_rollback_export','privacy_access_red_owner',NOW),/unavailable/);
  const retried=await repository.reviewRequest({requestId:'privacy_rollback_export',reviewerAccountId:'privacy_access_red_admin',reviewId:'privacy_retry_review',expectedStatus:'OPEN',decision:'COMPLETED',reason:'Retry after required history rollback is now valid.',now:NOW});
  assert.equal(retried.status,'COMPLETED');
 } finally {await db.close();}
});

test("current privacy download includes owned provided profile fields and excludes foreign profiles and internal audit payloads",async()=>{
 const db=await database();
 try {
  for(const id of ['profile_export_owner','profile_export_other']){
   await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,worker_reference,created_at,updated_at) VALUES($1,$2,$1,'active','fixture',$3,$3,$4,$3,$3)",[id,id+'@example.test',NOW,'ref_'+id]);
   await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[id,NOW]);
   const profile={schemaVersion:1,workerSub:id,workerId:'ref_'+id,version:1,status:'draft',personal:{legalFirstName:'Provided-'+id},contact:{city:'Home-'+id},professional:{jobTitle:'Role-'+id},audit:[{internal:'PRIVATE_STAFF_AUDIT_SENTINEL'}],createdAt:NOW,updatedAt:NOW,submittedAt:null};
   await db.query("INSERT INTO worker_profiles(worker_sub,worker_id,schema_version,version,status,profile_document,created_at,updated_at,submitted_at) VALUES($1,$2,1,1,'draft',$3::jsonb,$4,$4,NULL)",[id,'ref_'+id,JSON.stringify(profile),NOW]);
  }
  const data=await collectWorkerPrivacyData(db,'profile_export_owner',NOW);
  assert.equal(data.workerProfile.personal.legalFirstName,'Provided-profile_export_owner');
  assert.equal(data.workerProfile.contact.city,'Home-profile_export_owner');
  assert.equal(data.workerProfile.professional.jobTitle,'Role-profile_export_owner');
  assert.equal(JSON.stringify(data).includes('profile_export_other'),false);
  assert.equal(JSON.stringify(data).includes('PRIVATE_STAFF_AUDIT_SENTINEL'),false);
 } finally {await db.close();}
});
