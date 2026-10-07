import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";

const {WorkerAssessmentApplicationService,WorkerAssessmentApplicationAccessError}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
test("Application search filters the complete owned SQL dataset without matching foreign Workers or query injection", {timeout:120000}, async()=>{
 const fixture=await workerAssessmentSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const now=new Date(),expiry=new Date(now.getTime()+3600000).toISOString();
  await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES('search_native_session',$1,'worker','search_native_token','search_native_csrf',$2,$2,$3)",[fixture.credentials.worker.accountId,now.toISOString(),expiry]);
  const principal={activeRole:"worker",accountStatus:"active",accountId:fixture.credentials.worker.accountId,sessionId:"search_native_session"};
  const service=new WorkerAssessmentApplicationService(db);
  assert.deepEqual((await service.listApplications(principal,now,"Alpha")).map(row=>row.applicationId),[fixture.alpha]);
  assert.deepEqual((await service.listApplications(principal,now,fixture.beta)).map(row=>row.applicationId),[fixture.beta]);
  assert.equal((await service.listApplications(principal,now,"' OR 1=1 --")).length,0);
  assert.equal((await service.listApplications(principal,now,"%")).length,0);
  assert.equal((await service.listApplications(principal,now,"   ")).length,2);
  assert.equal((await service.listApplications(principal,now,"z".repeat(10000))).length,0);
  await db.query("UPDATE worker_assessment_applications SET application_status='PAYMENT_REQUIRED' WHERE application_id=$1",[fixture.beta]);
  assert.deepEqual((await service.listApplications(principal,now,"payment required")).map(row=>row.applicationId),[fixture.beta]);
  await db.query("UPDATE auth_sessions SET revoked_at=$1,revocation_reason='Search test revocation' WHERE session_id='search_native_session'",[now.toISOString()]);
  await assert.rejects(()=>service.listApplications(principal,now,"Alpha"),WorkerAssessmentApplicationAccessError);
 } finally {await db.close();await fixture.cleanup();}
});
