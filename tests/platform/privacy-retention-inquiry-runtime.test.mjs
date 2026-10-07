import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {PrivacyOperationsService}=loadWorkerRegistrationTs("src/lib/privacy/privacy-operations-service.ts");
const {PrivacyOperationsRepository}=loadWorkerRegistrationTs("src/lib/privacy/privacy-operations-repository.ts");
test("An owned retention inquiry can receive a persisted staff response and reasoned completion",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[fixture.credentials.assessor.accountId]);
  const service=new PrivacyOperationsService(new PrivacyOperationsRepository(Promise.resolve(db)));
  await service.request({requestId:"retention_inquiry_probe",workerId:fixture.credentials.worker.accountId,tenantId:null,type:"retention_inquiry",details:{question:"Please explain which assessment records remain retained."}});
  await service.reviewRequest({requestId:"retention_inquiry_probe",reviewerAccountId:fixture.credentials.assessor.accountId,expectedStatus:"OPEN",decision:"PROCESSING",reason:"Reviewing the current categories and any applicable holds."});
  const answer="Your assessment evidence remains retained under the current case policy. Active appeal holds prevent purge; this response does not delete records.";
  const done=await service.reviewRequest({requestId:"retention_inquiry_probe",reviewerAccountId:fixture.credentials.assessor.accountId,expectedStatus:"PROCESSING",decision:"COMPLETED",reason:answer});
  assert.equal(done.status,"COMPLETED");
  assert.equal(done.details.fulfilment.method,"retention_inquiry_response");
  const owned=await service.listWorkerPrivacy(null,fixture.credentials.worker.accountId,fixture.credentials.worker.accountId);
  assert.equal(owned.requests.find(row=>row.request_id==="retention_inquiry_probe").review_reason,answer);
  assert.deepEqual((await db.query("SELECT from_status,to_status,reason FROM privacy_request_reviews WHERE request_id='retention_inquiry_probe' ORDER BY review_sequence")).rows.map(row=>[row.from_status,row.to_status]),[["OPEN","PROCESSING"],["PROCESSING","COMPLETED"]]);
 }finally{await db.close();await fixture.cleanup();}
});

test("Retention response requires active staff and immutable review history; failures leave the inquiry open",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const service=new PrivacyOperationsService(new PrivacyOperationsRepository(Promise.resolve(db)));
  const worker=fixture.credentials.worker.accountId,admin=fixture.credentials.assessor.accountId;
  await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[admin]);
  await service.request({requestId:"retention_inquiry_rollback",workerId:worker,tenantId:null,type:"retention_inquiry",details:{question:"Explain current retention and active holds.",clientReply:"Untrusted client text is not the staff answer."}});
  const input={requestId:"retention_inquiry_rollback",reviewerAccountId:admin,expectedStatus:"OPEN",decision:"COMPLETED",reason:"The staff response explains the applicable record categories and active holds; no purge is performed."};
  await assert.rejects(()=>service.reviewRequest({...input,reviewerAccountId:worker}),/staff|review|authorized/i);
  await db.exec("CREATE FUNCTION fail_retention_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='retention_inquiry_rollback' THEN RAISE EXCEPTION 'required retention history failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_retention_review BEFORE INSERT ON privacy_request_reviews FOR EACH ROW EXECUTE FUNCTION fail_retention_review()");
  await assert.rejects(()=>service.reviewRequest(input),/required retention history failure/);
  let row=(await db.query("SELECT status,details,completed_at FROM privacy_requests WHERE request_id=$1",[input.requestId])).rows[0];
  assert.equal(row.status,"OPEN");assert.equal(row.completed_at,null);assert.equal(row.details.fulfilment,undefined);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM privacy_request_reviews WHERE request_id=$1",[input.requestId])).rows[0].total,0);
  await db.exec("DROP TRIGGER fail_retention_review ON privacy_request_reviews; DROP FUNCTION fail_retention_review()");
  await db.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1",[admin]);await assert.rejects(()=>service.reviewRequest(input),/staff|review|authorized/i);
  await db.query("UPDATE auth_accounts SET account_status='active' WHERE account_id=$1",[admin]);assert.equal((await service.reviewRequest(input)).status,"COMPLETED");
  await assert.rejects(()=>service.reviewRequest(input),/changed|unavailable/i);
  await assert.rejects(()=>service.listWorkerPrivacy(null,worker,admin),/owner mismatch/);
  assert.equal((await db.query("SELECT count(*)::int AS total FROM privacy_request_reviews WHERE request_id=$1",[input.requestId])).rows[0].total,1);
  row=(await db.query("SELECT reason FROM privacy_request_reviews WHERE request_id=$1",[input.requestId])).rows[0];assert.equal(row.reason,input.reason);
  await assert.rejects(()=>db.query("UPDATE privacy_request_reviews SET reason='replacement answer' WHERE request_id=$1",[input.requestId]),/immutable|append.only/i);
 }finally{await db.close();await fixture.cleanup();}
});
