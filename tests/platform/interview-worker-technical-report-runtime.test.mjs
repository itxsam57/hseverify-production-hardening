import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const {InterviewRuntimeService}=loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
async function withFixture(callback){
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const request=fixture.requests.Alpha;
  const row=(await db.query("SELECT worker_account_id FROM interview_requests WHERE interview_request_id=$1",[request.interviewRequestId])).rows[0];
  const worker={accountId:row.worker_account_id,activeRole:"worker",accountStatus:"active",sessionId:"native-technical-report",tenantMembership:null};
  const assessor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor);
  const scheduling=new InterviewSchedulingService(db),runtime=new InterviewRuntimeService(Promise.resolve(db));
  const schedule=scheduledAt=>scheduling.scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request,scheduledAt});
  const snapshot=async()=>({
   request:(await db.query("SELECT scheduled_at,status,technical_issue,schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[request.interviewRequestId])).rows,
   runtime:(await db.query("SELECT * FROM interview_runtime_sessions WHERE interview_request_id=$1",[request.interviewRequestId])).rows,
   events:(await db.query("SELECT * FROM interview_runtime_events ORDER BY occurred_at,event_id")).rows});
  await callback({db,request,worker,assessor,schedule,runtime,snapshot});
 }finally{await db.close();await fixture.cleanup()}
}
for(const [label,offset] of [["unscheduled",null],["too early",2*3600000],["too late",-5*3600000]]){
 test("Worker technical report rejects "+label+" before runtime without blocking scheduling",async()=>{
  await withFixture(async({request,worker,schedule,runtime,snapshot})=>{
   if(offset!==null)await schedule(new Date(Date.now()+offset).toISOString());
   const before=await snapshot();
   await assert.rejects(()=>runtime.technicalIssue(worker,request.interviewRequestId,"Camera cannot connect"),error=>error.name==="InterviewRuntimeConflictError");
   assert.deepEqual(await snapshot(),before);
   if(offset===null)assert((await schedule(new Date(Date.now()+86400000).toISOString())).scheduledAt);
  });
 });
}
test("Worker technical report initializes inside join window and remains available for an existing runtime",async()=>{
 await withFixture(async({db,request,worker,schedule,runtime})=>{
  await schedule(new Date(Date.now()+60000).toISOString());
  const first=await runtime.technicalIssue(worker,request.interviewRequestId,"Camera cannot connect");
  assert.equal(first.status,"TECHNICAL_HOLD");
  await db.query("UPDATE interview_requests SET scheduled_at=clock_timestamp()-INTERVAL '5 hours' WHERE interview_request_id=$1",[request.interviewRequestId]);
  const repeated=await runtime.technicalIssue(worker,request.interviewRequestId,"Microphone reconnect also failed");
  assert.equal(repeated.interviewSessionId,first.interviewSessionId);
  assert.equal(repeated.status,"TECHNICAL_HOLD");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM interview_runtime_events WHERE interview_session_id=$1 AND event_type='TECHNICAL_ISSUE'",[first.interviewSessionId])).rows[0].n,2);
 });
});
test("Worker technical report uses fresh database time after request lock",async()=>{
 await withFixture(async({db,request,worker,schedule,snapshot})=>{
  await schedule(new Date(Date.now()-4*3600000+1500).toISOString());
  const before=await snapshot();
  const wrapped={transaction:callback=>db.transaction(tx=>callback({query:async(sql,args)=>{
   const result=await tx.query(sql,args);
   if(sql.includes("FROM interview_requests")&&sql.includes("FOR UPDATE"))await new Promise(resolve=>setTimeout(resolve,2200));
   return result;
  }}))};
  await assert.rejects(()=>new InterviewRuntimeService(Promise.resolve(wrapped)).technicalIssue(worker,request.interviewRequestId,"Connection stalled while opening",new Date(Date.now()-3600000)),error=>error.name==="InterviewRuntimeConflictError");
  assert.deepEqual(await snapshot(),before);
 });
});
