import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {accommodationDeliveryFixture} from "../helpers/accommodation-delivery-fixture.mjs";
import {interviewAccommodationFixture} from "../helpers/interview-accommodation-fixture.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
async function snapshot(db,tables){
 const value={};for(const table of tables)value[table]=(await db.query("SELECT * FROM "+table+" ORDER BY 1")).rows;
 return JSON.stringify(value);
}
async function retainedDown(db,stem,tables){
 const before=await snapshot(db,tables),sql=await readFile("database/migrations/"+stem+".down.sql","utf8");
 let denial;try{await db.transaction(tx=>typeof tx.execute === "function" ? tx.execute(sql) : tx.exec(sql));}catch(e){denial=e;}
 let after;try{after=await snapshot(db,tables);}catch(e){after="UNAVAILABLE: "+e.message;}
 console.log(JSON.stringify({migration:stem,downRefused:!!denial,error:denial?.message??null,exactHistoryRetained:after===before,tablesStillAvailable:!after.startsWith("UNAVAILABLE:")}));
 assert.ok(denial,"Populated retained history must refuse actual down migration");
 assert.equal(denial.code,"55000","Refusal must come from explicit retained-history guard");
 assert.match(denial.message,/retain|history|immutable|rollback|support|execution|populated/i);
 assert.equal(after,before,"Refused down migration must preserve exact rows and columns");
}
test("0096 actual privacy correction execution receipts survive rollback refusal",async()=>{
 const c=await accommodationDeliveryFixture({seed:"privacy-down"});
 try{
 const {createEmptyWorkerProfile}=loadTs("src/lib/worker/profile-domain.ts");
 const worker=c.worker.accountId,ref=(await c.db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[worker])).rows[0].worker_reference;
 const now=new Date().toISOString(),profile={...createEmptyWorkerProfile({workerSub:worker,workerId:ref,displayName:"Retained Privacy Worker",email:c.worker.email,now}),version:1};profile.contact.city="Old city";
 await c.db.query("INSERT INTO worker_profiles(worker_sub,worker_id,schema_version,version,status,profile_document,created_at,updated_at) VALUES($1,$2,1,1,'draft',$3::jsonb,$4,$4) ON CONFLICT(worker_sub) DO UPDATE SET version=1,status='draft',profile_document=$3::jsonb",[worker,ref,JSON.stringify(profile),now]);
 const correction={scope:"profile_contact_city",city:"New city",expectedProfileVersion:1};
 await c.privacy.request({requestId:"retained_city_probe",workerId:worker,tenantId:null,type:"correction",details:{correction}});
 await c.privacy.reviewRequest({requestId:"retained_city_probe",reviewerAccountId:c.admin.accountId,reviewerSessionId:c.admin.sessionId,expectedStatus:"OPEN",decision:"COMPLETED",reason:"Approved precise correction with retained execution receipt.",approvedCorrection:correction});
 assert.deepEqual((await c.db.query("SELECT event_type FROM privacy_execution_events WHERE request_id='retained_city_probe' ORDER BY event_sequence")).rows.map(x=>x.event_type),["APPROVED","EXECUTED"]);
 await retainedDown(c.db,"0096_privacy_execution_history",["privacy_execution_events","retention_jobs","privacy_requests","worker_profiles"]);
 }finally{await c.cleanup();}
});
test("0097 actual assessment accommodation snapshot and break survive rollback refusal",async()=>{
 const c=await accommodationDeliveryFixture({seed:"assessment-down"});
 try{
 await c.service.startApprovedBreak(c.worker,{attemptId:c.begun.attempt.attemptId,durationSeconds:60,mutationKey:"retained_down_break_0001"},null,new Date(c.now.getTime()+10000));
 assert.equal((await c.db.query("SELECT count(*)::int AS n FROM assessment_accommodation_breaks")).rows[0].n,1);
 await retainedDown(c.db,"0097_operative_accommodation_delivery",["assessment_attempt_accommodations","assessment_accommodation_breaks"]);
 }finally{await c.cleanup();}
});
test("0097 actual assigned human support message and session snapshot survive rollback refusal",async()=>{
 const c=await interviewAccommodationFixture({seed:"support-down"});
 try{
 const {InterviewAccommodationSupportService}=loadTs("src/lib/privacy/interview-accommodation-support.ts");
 await new InterviewAccommodationSupportService(Promise.resolve(c.database)).publish(c.assessor,c.request.interviewRequestId,{kind:"CAPTION",sourceText:"Retained assigned human caption.",mutationKey:"retained_down_caption_0001"},c.now);
 assert.equal((await c.database.query("SELECT count(*)::int AS n FROM interview_accommodation_support_messages")).rows[0].n,1);
 await retainedDown(c.database,"0097_operative_accommodation_delivery",["interview_accommodation_support_messages","interview_accommodation_support_snapshots","interview_runtime_sessions"]);
 }finally{await c.cleanup();}
});

test("0096 completed real zero-target retention result alone prevents losing its completion columns",async()=>{
 const c=await accommodationDeliveryFixture({seed:"retention-down"});
 try{
 const tenant=c.fixture.credentials.company.tenantId,id="retained_empty_retention";
 await c.privacy.scheduleRetention({id,tenantId:tenant,resourceType:"expired_interview_recordings",before:new Date().toISOString()});
 const done=await c.privacy.completeRetention({id,tenantId:tenant,status:"PENDING",reviewerAccountId:c.admin.accountId,reviewerSessionId:c.admin.sessionId,reason:"Approved legitimate zero-target retention under stored policy."});
 assert.equal(done.status,"COMPLETED");assert.equal(done.executionResult.purgedRecordings,0);
 assert.equal((await c.db.query("SELECT count(*)::int AS n FROM privacy_execution_events")).rows[0].n,0);
 const row=(await c.db.query("SELECT completed_at,execution_result FROM retention_jobs WHERE job_id=$1",[id])).rows[0];assert.ok(row.completed_at);assert.equal(row.execution_result.historyRetained,true);
 await retainedDown(c.db,"0096_privacy_execution_history",["privacy_execution_events","retention_jobs"]);
 }finally{await c.cleanup();}
});
test("0097 actual assessment snapshot alone is retained before the Worker takes any break",async()=>{
 const c=await accommodationDeliveryFixture({seed:"snapshot-down"});
 try{
 assert.equal((await c.db.query("SELECT count(*)::int AS n FROM assessment_attempt_accommodations")).rows[0].n,1);
 assert.equal((await c.db.query("SELECT count(*)::int AS n FROM assessment_accommodation_breaks")).rows[0].n,0);
 await retainedDown(c.db,"0097_operative_accommodation_delivery",["assessment_attempt_accommodations","assessment_accommodation_breaks"]);
 }finally{await c.cleanup();}
});
for(const [stem,previous] of [["0096_privacy_execution_history","0095_assessment_funding_notifications"],["0097_operative_accommodation_delivery","0096_privacy_execution_history"]])test(stem+" empty history supports real down and up reapplication",async()=>{
 const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://",releaseSha:"history-rollback-empty"});
 try{
 await applyMigrationsThrough(db,"history-rollback-empty",previous);
 const up=await readFile("database/migrations/"+stem+".up.sql","utf8"),down=await readFile("database/migrations/"+stem+".down.sql","utf8");
 await db.transaction(tx=>tx.execute(up));
 const schema=async()=>JSON.stringify((await db.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows);
 const before=await schema();
 await db.transaction(tx=>tx.execute(down));
 assert.notEqual(await schema(),before);
 await db.transaction(tx=>tx.execute(up));
 assert.equal(await schema(),before);
 }finally{await db.close();}
});
