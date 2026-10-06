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
const {PrivacyOperationsRepository}=realTs("src/lib/privacy/privacy-operations-repository.ts");
const {ConsentRecordService}=realTs("src/lib/privacy/consent-record-service.ts");
test("owned scoped-consent withdrawal request performs withdrawal and recipient revocation before completion",async()=>{
 const db=await database();
 try {
  for(const [id,role,ref] of [['request_consent_worker','worker','request_consent_ref'],['request_consent_other','worker','request_consent_foreign_ref'],['request_consent_admin','admin',null]]){
   await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,worker_reference,created_at,updated_at) VALUES($1,$2,$1,'active','fixture',$3,$3,$4,$3,$3)",[id,id+'@example.test',NOW,ref]);
   await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[id,role,NOW]);
  }
  const consentService=new ConsentRecordService(Promise.resolve(db));
  const consentIds=[];
  for(const [id,ref] of [['request_consent_worker','request_consent_ref'],['request_consent_other','request_consent_foreign_ref']]){
   const shareId='share_'+id;
   await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES($1,$2,'[]','Requested scoped sharing',$3,$4)",[shareId,ref,NOW,'s'.repeat(64)]);
   const consent=await consentService.grant({workerId:id,actorAccountId:id,consentType:'scoped_share_links',purpose:'Withdraw this selected optional sharing consent only.',metadata:{shareLinkId:shareId},now:new Date(NOW)});
   consentIds.push(consent.consentId);
  }
  const repository=new PrivacyOperationsRepository(Promise.resolve(db));
  await repository.createRequest({requestId:'consent_request_owned',workerId:'request_consent_worker',tenantId:null,type:'consent_withdrawal',details:{consentId:consentIds[0],consentPurpose:'Forged client purpose'}});
  const result=await repository.reviewRequest({requestId:'consent_request_owned',reviewerAccountId:'request_consent_admin',reviewId:'consent_request_review',expectedStatus:'OPEN',decision:'COMPLETED',reason:'Withdrew the specifically requested optional sharing consent.',now:'2026-10-01T00:10:00.000Z'});
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.details.consentPurpose,'Withdraw this selected optional sharing consent only.');
  const own=await consentService.listWorkerHistory('request_consent_worker');
  assert.deepEqual(own.map(r=>r.action),['WITHDRAWN','GRANTED']);
  assert.equal(own[0].actorAccountId,'request_consent_admin');
  const links=(await db.query("SELECT share_link_id,revoked_at FROM scoped_share_links ORDER BY share_link_id")).rows;
  assert.ok(links.find(r=>r.share_link_id==='share_request_consent_worker').revoked_at);
  assert.equal(links.find(r=>r.share_link_id==='share_request_consent_other').revoked_at,null);
  await assert.rejects(repository.createRequest({requestId:'consent_request_foreign',workerId:'request_consent_worker',tenantId:null,type:'consent_withdrawal',details:{consentId:consentIds[1]}}),/Worker/);
  await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('share_consent_rollback','request_consent_ref','[]','Rollback requested sharing',$1,$2)",[NOW,'r'.repeat(64)]);
  const rollbackConsent=await consentService.grant({workerId:'request_consent_worker',actorAccountId:'request_consent_worker',consentType:'scoped_share_links',purpose:'Required review failure must roll back this scoped withdrawal.',metadata:{shareLinkId:'share_consent_rollback'},now:new Date(NOW)});
  await repository.createRequest({requestId:'consent_request_rollback',workerId:'request_consent_worker',tenantId:null,type:'consent_withdrawal',details:{consentId:rollbackConsent.consentId}});
  const decision={requestId:'consent_request_rollback',reviewerAccountId:'request_consent_admin',reviewId:'consent_rollback_review',expectedStatus:'OPEN',decision:'COMPLETED',reason:'Withdrew owned optional sharing with required staff history.',now:'2026-10-01T00:11:00.000Z'};
  await db.query("CREATE FUNCTION reject_consent_request_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='consent_request_rollback' THEN RAISE EXCEPTION 'injected consent history failure'; END IF; RETURN NEW; END; $$");
  await db.query("CREATE TRIGGER reject_consent_request_history BEFORE INSERT ON privacy_request_reviews FOR EACH ROW EXECUTE FUNCTION reject_consent_request_history()");
  await assert.rejects(repository.reviewRequest(decision),/injected consent history failure/);
  assert.equal((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='share_consent_rollback'")).rows[0].revoked_at,null);
  assert.equal((await db.query("SELECT status FROM privacy_requests WHERE request_id='consent_request_rollback'")).rows[0].status,'OPEN');
  assert.equal((await consentService.listWorkerHistory('request_consent_worker')).filter(r=>r.consentId===rollbackConsent.consentId).length,1);
  await db.query("DROP TRIGGER reject_consent_request_history ON privacy_request_reviews");
  await db.query("DROP FUNCTION reject_consent_request_history()");
  assert.equal((await repository.reviewRequest(decision)).status,'COMPLETED');
  assert.deepEqual((await consentService.listWorkerHistory('request_consent_worker')).filter(r=>r.consentId===rollbackConsent.consentId).map(r=>r.action),['WITHDRAWN','GRANTED']);
  assert.ok((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='share_consent_rollback'")).rows[0].revoked_at);
  const required=await consentService.grant({workerId:'request_consent_worker',actorAccountId:'request_consent_worker',consentType:'interview_recording',purpose:'Required active interview recording cannot be withdrawn here.',withdrawalRule:'NOT_WITHDRAWABLE_WHILE_REQUIRED',now:new Date(NOW)});
  await assert.rejects(repository.createRequest({requestId:'consent_request_required',workerId:'request_consent_worker',tenantId:null,type:'consent_withdrawal',details:{consentId:required.consentId}}),/optional sharing consent.*Worker/);
  await db.query("INSERT INTO privacy_requests(request_id,worker_id,request_type,details) VALUES('consent_request_legacy_foreign','request_consent_worker','consent_withdrawal',$1::jsonb)",[JSON.stringify({consentId:consentIds[1]})]);
  await assert.rejects(repository.reviewRequest({...decision,requestId:'consent_request_legacy_foreign',reviewId:'consent_legacy_foreign_review'}),/Worker/);
  assert.equal((await db.query("SELECT status FROM privacy_requests WHERE request_id='consent_request_legacy_foreign'")).rows[0].status,'OPEN');
  assert.equal((await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='share_request_consent_other'")).rows[0].revoked_at,null);

 } finally {await db.close();}
});
