import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assessorInterviewSearchFixture } from "../helpers/assessor-interview-search-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { PrivacyOperationsService } = loadTs("src/lib/privacy/privacy-operations-service.ts");
const { PrivacyOperationsRepository } = loadTs("src/lib/privacy/privacy-operations-repository.ts");
const { assertPrivacyAdmin } = loadTs("src/lib/privacy/privacy-execution.ts");
const { FilesystemPrivateObjectStorage } = loadTs("src/lib/secure-files/private-object-storage-core.ts");
const { createEmptyWorkerProfile } = loadTs("src/lib/worker/profile-domain.ts");
const id = (prefix, seed) => prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);

async function context() {
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 const directory=await mkdtemp(join(tmpdir(),"hse-privacy-execution-"));
 const storage=new FilesystemPrivateObjectStorage({trustedBasePath:directory,rootPath:join(directory,"objects")});
 const worker=fixture.credentials.worker.accountId,admin=fixture.credentials.admin.accountId,now=new Date().toISOString();
 const session="privacy_execution_admin_session";
 await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'admin',$3,$4,$5,$5,$6)",[session,admin,"privacy_admin_token_hash","privacy_admin_csrf_hash",now,new Date(Date.now()+3600000).toISOString()]);
 const repository=new PrivacyOperationsRepository(Promise.resolve(db),storage),service=new PrivacyOperationsService(repository);
 return {fixture,db,directory,storage,worker,admin,session,now,repository,service,
  review:(requestId,extra={})=>service.reviewRequest({requestId,reviewerAccountId:admin,reviewerSessionId:session,expectedStatus:"OPEN",decision:"COMPLETED",reason:"Approved the exact requested operation after policy review.",...extra}),
  cleanup:async()=>{await db.close();await fixture.cleanup();await rm(directory,{recursive:true,force:true});}};
}
async function profile(c) {
 const ref=(await c.db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[c.worker])).rows[0].worker_reference;
 const value={...createEmptyWorkerProfile({workerSub:c.worker,workerId:ref,displayName:"Privacy Worker",email:"unused@example.test",now:c.now}),version:1};
 value.contact.city="Old city";
 await c.db.query("INSERT INTO worker_profiles(worker_sub,worker_id,schema_version,version,status,profile_document,created_at,updated_at) VALUES($1,$2,1,1,'draft',$3::jsonb,$4,$4) ON CONFLICT(worker_sub) DO UPDATE SET version=1,status='draft',profile_document=$3::jsonb",[c.worker,ref,JSON.stringify(value),c.now]);
 return value;
}
async function recording(c,seed="allowed",options={}) {
 const request=c.fixture.requests.Alpha,caseId=request.caseId;
 if(options.closed!==false) await c.db.query("UPDATE assurance_cases SET case_status='Closed',owner_kind=NULL,next_action=NULL,closed_at=$2 WHERE case_id=$1",[caseId,c.now]);
 const bytes=Buffer.from("private recording "+seed),hash=createHash("sha256").update(bytes).digest("hex"),key="secure-files/"+createHash("sha256").update(seed).digest("hex"),asset=id("recording_asset",seed);
 await c.storage.put(key,bytes);
 await c.db.query("INSERT INTO recording_assets(recording_asset_id,purpose,interview_request_id,case_id,tenant_id,worker_account_id,captured_by_account_id,source,mime_type,object_key,ingest_key_hash,byte_size,content_sha256,status,started_at,ended_at,retention_until,legal_hold,created_at) VALUES($1,'INTERVIEW',$2,$3,$4,$5,$6,'AUDIO_ONLY','audio/webm',$7,$8,$9,$10,'AVAILABLE',$11,$11,$12,$13,$14)",[asset,request.interviewRequestId,caseId,c.fixture.credentials.company.tenantId,options.worker??c.worker,c.admin,key,createHash("sha256").update("ingest-"+seed).digest("hex"),bytes.length,hash,"2026-01-01T00:00:00Z",options.future?new Date(Date.now()+86400000).toISOString():"2026-02-01T00:00:00Z",options.hold??false,"2026-01-01T00:00:00Z"]);
 return {asset,key,caseId};
}
test("Privacy execution Admin authority locks account, role, then session in deterministic order",async()=>{
 const calls=[];
 const tx={query:async(sql,params)=>{
  calls.push({sql:String(sql),params});
  if(String(sql).includes("FROM auth_accounts"))return {rows:[{account_id:"admin_account"}]};
  if(String(sql).includes("FROM auth_account_roles"))return {rows:[{account_id:"admin_account"}]};
  if(String(sql).includes("FROM auth_sessions"))return {rows:[{session_id:"admin_session"}]};
  throw new Error("Unexpected Admin authority query.");
 }};
 const input={reviewerAccountId:"admin_account",reviewerSessionId:"admin_session",now:"2026-10-17T00:00:00.000Z",
  reason:"Approved exact operation under policy."};
 await assertPrivacyAdmin(tx,input);
 assert.equal(calls.length,3);
 assert.match(calls[0].sql,/FROM auth_accounts[\s\S]*account_status='active'[\s\S]*FOR SHARE/);
 assert.match(calls[1].sql,/FROM auth_account_roles[\s\S]*role='admin'[\s\S]*FOR SHARE/);
 assert.match(calls[2].sql,/FROM auth_sessions[\s\S]*session_id=\$2[\s\S]*active_role='admin'[\s\S]*revoked_at IS NULL[\s\S]*expires_at>\$3::timestamptz[\s\S]*FOR SHARE/);
 assert.deepEqual(calls.map(call=>call.params),[
  ["admin_account"],["admin_account"],["admin_account","admin_session",input.now]
 ]);
 assert.doesNotMatch(calls.map(call=>call.sql).join("\n"),/JOIN auth_accounts|FOR SHARE OF accounts,roles,sessions/);
});

test("Worker typed correction -> exact Admin approval -> profile consumer with immutable before/after amendment",async()=>{
 const c=await context();
 try {
  await profile(c);
  const change={scope:"profile_contact_city",city:"New city",expectedProfileVersion:1};
  await c.service.request({requestId:"typed_city",workerId:c.worker,tenantId:null,type:"correction",details:{correction:change}});
  await assert.rejects(c.review("typed_city",{approvedCorrection:{...change,city:"Different city"}}),/exact|match|approval/i);
  const done=await c.review("typed_city",{approvedCorrection:change});
  assert.equal(done.status,"COMPLETED");
  const stored=(await c.db.query("SELECT version,profile_document FROM worker_profiles WHERE worker_sub=$1",[c.worker])).rows[0];
  assert.equal(stored.version,2);assert.equal(stored.profile_document.contact.city,"New city");
  const {DatabaseWorkerProfileRepository}=loadTs("src/lib/worker/profile-repository.ts");
  assert.equal((await new DatabaseWorkerProfileRepository(Promise.resolve(c.db)).load(c.worker)).contact.city,"New city");
  const history=(await c.db.query("SELECT before_state,after_state FROM privacy_execution_events WHERE request_id='typed_city' AND event_type='EXECUTED'")).rows[0];
  assert.equal(history.before_state.city,"Old city");assert.equal(history.after_state.city,"New city");
  await assert.rejects(c.db.query("DELETE FROM privacy_execution_events WHERE request_id='typed_city'"),/append.only|immutable/i);
  await assert.rejects(c.review("typed_city",{approvedCorrection:change}),/changed|unavailable/i);
 } finally {await c.cleanup();}
});
test("Correction rejects stale versions, revoked Admin sessions and arbitrary field writes without changing owner",async()=>{
 const c=await context();
 try {
  await profile(c);
  const change={scope:"profile_contact_city",city:"New city",expectedProfileVersion:1};
  await c.service.request({requestId:"stale_city",workerId:c.worker,tenantId:null,type:"correction",details:{correction:change}});
  await c.db.query("UPDATE worker_profiles SET version=2,profile_document=jsonb_set(profile_document,'{version}','2') WHERE worker_sub=$1",[c.worker]);
  await assert.rejects(c.review("stale_city",{approvedCorrection:change}),/changed|version/i);
  await c.db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='test' WHERE session_id=$1",[c.session,c.now]);
  await assert.rejects(c.review("stale_city",{approvedCorrection:change}),/Admin|authorization|session/i);
  await assert.rejects(c.service.request({requestId:"arbitrary_city",workerId:c.worker,tenantId:null,type:"correction",details:{correction:{...change,table:"auth_accounts",field:"password_hash"}}}),/supported|scope|field/i);
  assert.equal((await c.db.query("SELECT profile_document->'contact'->>'city' AS city FROM worker_profiles WHERE worker_sub=$1",[c.worker])).rows[0].city,"Old city");
 } finally {await c.cleanup();}
});
test("Expired recording erasure removes actual bytes, retains metadata/history and revokes own sessions and links",async()=>{
 const c=await context();
 try {
  const target=await recording(c);
  const ref=(await c.db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[c.worker])).rows[0].worker_reference;
  await c.db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES('privacy_worker_session',$1,'worker','privacy_worker_token','privacy_worker_csrf',$2,$2,$3)",[c.worker,c.now,new Date(Date.now()+3600000).toISOString()]);
  await c.db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('privacy_erase_share',$1,'[]','Privacy erase fixture',$2,$3)",[ref,c.now,"a".repeat(64)]);
  await c.service.request({requestId:"erase_recording",workerId:c.worker,tenantId:null,type:"deletion",details:{deletion:{scope:"expired_recording",recordingAssetId:target.asset}}});
  const done=await c.review("erase_recording",{approvedDeletion:{scope:"expired_recording",recordingAssetId:target.asset}});
  assert.equal(done.status,"COMPLETED");assert.equal(await c.storage.stat(target.key),null);
  assert.equal((await c.db.query("SELECT status FROM recording_assets WHERE recording_asset_id=$1",[target.asset])).rows[0].status,"PURGED");
  assert.ok((await c.db.query("SELECT revoked_at FROM auth_sessions WHERE session_id='privacy_worker_session'")).rows[0].revoked_at);
  assert.ok((await c.db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='privacy_erase_share'")).rows[0].revoked_at);
  assert.deepEqual((await c.db.query("SELECT event_type FROM privacy_execution_events WHERE request_id='erase_recording' ORDER BY event_sequence")).rows.map(x=>x.event_type),["APPROVED","EXECUTED"]);
  assert.ok((await c.db.query("SELECT count(*)::int AS n FROM assurance_cases WHERE case_id=$1",[target.caseId])).rows[0].n);
 } finally {await c.cleanup();}
});
test("Erasure blocks legal holds, unexpired policy, open cases, foreign Worker targets and preserves objects",async()=>{
 const c=await context();
 try {
  for(const [seed,options,pattern] of [["held",{hold:true},/hold/i],["future",{future:true},/retention|expired/i],["open",{closed:false},/case/i],["foreign",{worker:"search_foreign_worker"},/owner|Worker|belong/i]]){
   const target=await recording(c,seed,options);
   if(seed==="open") await c.db.query("UPDATE assurance_cases SET case_status='Interview pending',owner_kind='assessor',next_action='Complete assigned interview.',closed_at=NULL WHERE case_id=$1",[target.caseId]);
   const run=async()=>{await c.service.request({requestId:"erase_"+seed,workerId:c.worker,tenantId:null,type:"deletion",details:{deletion:{scope:"expired_recording",recordingAssetId:target.asset}}});await c.review("erase_"+seed,{approvedDeletion:{scope:"expired_recording",recordingAssetId:target.asset}});};
   await assert.rejects(run,pattern);assert.ok(await c.storage.stat(target.key));
  }
 } finally {await c.cleanup();}
});
test("Retention status-only completion is rejected instead of claiming a purge",async()=>{
 const c=await context();
 try {
  const target=await recording(c,"retention");
  await c.service.scheduleRetention({id:"retention_actual",tenantId:c.fixture.credentials.company.tenantId,resourceType:"expired_interview_recordings",before:c.now});
  await assert.rejects(c.service.completeRetention({id:"retention_actual",tenantId:c.fixture.credentials.company.tenantId,status:"PENDING"}),/Admin|authorized|approval/i);
  assert.ok(await c.storage.stat(target.key));
 } finally {await c.cleanup();}
});

test("Erasure resumes its committed exact plan after bytes disappeared but completion persistence failed",async()=>{
 const c=await context();
 try {
  const target=await recording(c,"retry"),deletion={scope:"expired_recording",recordingAssetId:target.asset};
  await c.service.request({requestId:"erase_retry",workerId:c.worker,tenantId:null,type:"deletion",details:{deletion}});
  const original=c.storage.delete.bind(c.storage);
  c.storage.delete=async(key)=>{await original(key);throw new Error("Injected failure after object erasure");};
  await assert.rejects(c.review("erase_retry",{approvedDeletion:deletion}),/Injected failure/);
  assert.equal(await c.storage.stat(target.key),null);
  assert.equal((await c.db.query("SELECT status FROM privacy_requests WHERE request_id='erase_retry'")).rows[0].status,"OPEN");
  assert.equal((await c.db.query("SELECT status FROM recording_assets WHERE recording_asset_id=$1",[target.asset])).rows[0].status,"AVAILABLE");
  assert.equal((await c.db.query("SELECT count(*)::int AS n FROM privacy_execution_events WHERE request_id='erase_retry'")).rows[0].n,1);
  await assert.rejects(c.review("erase_retry",{decision:"REJECTED",reason:"Attempt to reject after the durable erasure plan was approved."}),/pending|approved|resume/i);
  c.storage.delete=original;
  assert.equal((await c.review("erase_retry",{approvedDeletion:deletion})).status,"COMPLETED");
  assert.equal((await c.db.query("SELECT count(*)::int AS n FROM privacy_execution_events WHERE request_id='erase_retry'")).rows[0].n,2);
 }finally{await c.cleanup();}
});
test("Open appeals protect recording bytes and retention executes only its allowed tenant/category",async()=>{
 const c=await context();
 try {
  const target=await recording(c,"appeal"),ref=(await c.db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[c.worker])).rows[0].worker_reference;
  await c.db.query("INSERT INTO credential_appeals(appeal_id,credential_id,worker_id,reason,status,version,created_at,updated_at) VALUES('privacy_open_appeal','fixture-credential',$1,'Retain this recording for appeal','submitted',1,$2,$2)",[ref,c.now]);
  const deletion={scope:"expired_recording",recordingAssetId:target.asset};
  await c.service.request({requestId:"erase_appeal",workerId:c.worker,tenantId:null,type:"deletion",details:{deletion}});
  await assert.rejects(c.review("erase_appeal",{approvedDeletion:deletion}),/open appeal/i);
  assert.ok(await c.storage.stat(target.key));
  const tenant=c.fixture.credentials.company.tenantId;
  await c.service.scheduleRetention({id:"retention_allowed",tenantId:tenant,resourceType:"expired_interview_recordings",before:c.now});
  const approval={id:"retention_allowed",tenantId:tenant,status:"PENDING",reviewerAccountId:c.admin,reviewerSessionId:c.session,reason:"Approved eligible expired interview recordings under stored policy."};
  await assert.rejects(c.service.completeRetention(approval),/open appeal/i);
  await assert.rejects(c.service.completeRetention({...approval,tenantId:"another_tenant"}),/unavailable/i);
  assert.ok(await c.storage.stat(target.key));
  await c.db.query("UPDATE credential_appeals SET status='withdrawn' WHERE appeal_id='privacy_open_appeal'");
  const result=await c.service.completeRetention(approval);
  assert.equal(result.status,"COMPLETED");assert.equal(result.executionResult.purgedRecordings,1);
  assert.equal(await c.storage.stat(target.key),null);
  const jobs=await c.service.listRetentionJobs();
  assert.equal(jobs.find(j=>j.job_id==="retention_allowed").execution_result.purgedRecordings,1);
  await c.service.scheduleRetention({id:"retention_unsupported",tenantId:tenant,resourceType:"audit",before:c.now});
  await assert.rejects(c.service.completeRetention({...approval,id:"retention_unsupported"}),/supported policy executor/i);
  assert.equal((await c.db.query("SELECT status FROM retention_jobs WHERE job_id='retention_unsupported'")).rows[0].status,"PENDING");
 }finally{await c.cleanup();}
});
