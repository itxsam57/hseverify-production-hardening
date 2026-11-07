import assert from "node:assert/strict";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {reviewQualityFixture} from "../helpers/review-quality-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const load=p=>loadWorkerRegistrationTs("src/lib/"+p+".ts");
const {StaffCalibrationService}=load("review/staff-calibration-service");
const {InterviewSchedulingService}=load("interview/interview-scheduling-service");
const {InterviewRuntimeService}=load("interview/interview-runtime-service");
const databaseUrl=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if(!databaseUrl)throw new Error("Actual isolated PostgreSQL URL is required for interview calibration contention proof");
test("Actual PostgreSQL held interview claims observe later FAILED calibration and expiry",{timeout:60000},async()=>{
const url=new URL(databaseUrl);
const environment={databaseDriver:"postgres",databaseUrl:url.href};
const name="independent_interview_cal_"+Date.now()+"_"+process.pid;
const admin=await openScriptDatabase(environment);
let first,second,control,created=false;
const receipts=[];
function trace(db){return {query:(sql,args)=>{if(args?.some(x=>x===undefined))throw new Error("Diagnostic fixture undefined parameter at "+args.map((x,i)=>x===undefined?i:"-").filter(x=>x!=="-").join(",")+" SQL "+sql.slice(0,150));return db.query(sql,args);},execute:sql=>db.execute(sql),transaction:fn=>db.transaction(tx=>fn(trace(tx))),close:()=>db.close()};}

async function waitBlocked(db,pid){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){
  const row=(await db.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0];
  if(row?.wait_event_type==="Lock")return;
  await new Promise(r=>setTimeout(r,25));
 }
 throw new Error("Actual runtime claim did not wait on held PostgreSQL request lock.");
}
try{
 await admin.execute('CREATE DATABASE "'+name+'"');created=true;url.pathname="/"+name;
 const env={...environment,databaseUrl:url.href};
 first=trace(await openScriptDatabase(env));second=trace(await openScriptDatabase(env));control=trace(await openScriptDatabase(env));
 await applyMigrationsThrough(first,"independent-interview-calibration-lock", "0120_review_recovery_notifications");
 const f=await reviewQualityFixture({database:first});
 await f.queue("CALIBRATION-PINNED-CONTEXT");
 const base=f.verifiers[0];
 await first.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'assessor')",[base.accountId]);
 await first.query("UPDATE auth_sessions SET active_role='assessor' WHERE session_id=$1",[base.sessionId]);
 const actor={...base,activeRole:"assessor"};
 const revision=(await first.query("SELECT framework_version_id FROM assurance_framework_revisions WHERE framework_id=$1 ORDER BY version_no DESC LIMIT 1",[f.frameworkId])).rows[0].framework_version_id;
 async function calibration(db,status,until){
  return new StaffCalibrationService(Promise.resolve(db)).record(f.admin,{accountId:actor.accountId,role:"assessor",frameworkReference:"HSE-PROOF",frameworkVersionId:revision,status,validFrom:new Date(Date.now()-1),validUntil:until,note:"Independent actual PostgreSQL calibration contention diagnostic."});
 }
 const schedule=new InterviewSchedulingService(first);
 async function scheduled(){
  let request=await schedule.requestAdditionalInterview({tenantId:f.principal.tenantMembership.tenantId,caseId:f.caseId,workerAccountId:f.worker.accountId,requestedAt:new Date().toISOString(),timezone:"UTC"});
  request=await schedule.assignInterview({tenantId:f.principal.tenantMembership.tenantId,request,assessorAccountId:actor.accountId});
  return schedule.scheduleInterview({principal:actor,tenantId:f.principal.tenantMembership.tenantId,request,scheduledAt:new Date().toISOString()});
 }
 async function heldClaim(request,mode,until=null){
  let release,ready;const barrier=new Promise(r=>release=r),locked=new Promise(r=>ready=r);
  const writer=first.transaction(async tx=>{
   await tx.query("SELECT interview_request_id FROM interview_requests WHERE interview_request_id=$1 FOR UPDATE",[request.interviewRequestId]);
   ready();await barrier;
   if(mode==="failed")await calibration(tx,"FAILED",new Date("2099-01-01"));
  });
  await locked;
  const pid=(await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const pending=new InterviewRuntimeService(Promise.resolve(second)).claim(actor,request.interviewRequestId);
  const result=pending.then(()=>({ok:true}),error=>({ok:false,message:error.message}));
  try{
   await waitBlocked(control,pid);
   if(mode==="expiry"){
    const delay=Math.max(0,until.getTime()-Date.now()+175);
    if(delay>10000)throw new Error("Unexpected diagnostic expiry delay.");
    await new Promise(r=>setTimeout(r,delay));
   }
  }finally{release();}
  await writer;
  const outcome=await result;
  assert.equal(outcome.ok,false,"A delayed actual runtime claim must reject unavailable calibration.");
  assert.match(outcome.message,/calibration/i);
  assert.equal((await control.query("SELECT COUNT(*)::integer n FROM interview_runtime_sessions WHERE interview_request_id=$1",[request.interviewRequestId])).rows[0].n,0);
  const receipt={scenario:mode==="failed"?"CURRENT superseded by FAILED while request lock held":"CURRENT expired while request lock held",status:"PASS",actualPostgres:true,actualRuntimeClaim:true,observedBlocked:true,noRuntimeCreated:true};
  receipts.push(receipt);console.log(JSON.stringify(receipt));
 }
 await calibration(first,"CURRENT",new Date("2099-01-01"));
 const failed=await scheduled();await heldClaim(failed,"failed");
 await calibration(first,"CURRENT",new Date("2099-01-01"));
 const expired=await scheduled(),until=new Date(Date.now()+2000);
 await calibration(first,"CURRENT",until);
 await heldClaim(expired,"expiry",until);
 console.log("INDEPENDENT_POSTGRES_CALIBRATION_PROOF 2/2 PASS");
}finally{
 if(first)await first.close();if(second)await second.close();if(control)await control.close();
 if(created)await admin.execute('DROP DATABASE "'+name+'"');
 await admin.close();
}
});
