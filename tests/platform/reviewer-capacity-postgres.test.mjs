import assert from "node:assert/strict";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyPendingMigrations} from "../../scripts/lib/migrations.mjs";
import {assertRegistrationCapacityLifecycle} from "../helpers/registration-capacity-lifecycle.mjs";
import {assertStaffCapacityLifecycle} from "../helpers/staff-capacity-lifecycle.mjs";
import {reviewQualityFixture} from "../helpers/review-quality-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {ReviewQualityService}=loadWorkerRegistrationTs("src/lib/review/review-quality-service.ts");
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const databaseUrl=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if(!databaseUrl)throw new Error("Actual isolated PostgreSQL URL is required for reviewer capacity proof");
test("Actual PostgreSQL two-client reviewer capacity admits one claim and preserves the other source",{timeout:60000},async()=>{
 const url=new URL(databaseUrl),name="review_capacity_"+Date.now()+"_"+process.pid;
 const environment={databaseDriver:"postgres",databaseUrl:url.href};const admin=await openScriptDatabase(environment);await admin.execute('CREATE DATABASE "'+name+'"');url.pathname="/"+name;
 const first=await openScriptDatabase({...environment,databaseUrl:url.href}),second=await openScriptDatabase({...environment,databaseUrl:url.href});
 try{
  await applyPendingMigrations(first,"postgres-review-capacity");
  await assertRegistrationCapacityLifecycle(first);
  await assertStaffCapacityLifecycle(first,second);
  const f=await reviewQualityFixture({database:first}),a=await f.queue("CAPACITY-A"),b=await f.queue("CAPACITY-B"),reviewer=f.verifiers[0];
  await new ReviewQualityService(first).setCapacity(f.admin,{accountId:reviewer.accountId,maxOpenReviews:1,expectedRevision:0,reason:"One open review is the explicit two-client contention limit."});
  // A producer holds capacity before inserting its account FK. Settings must not
  // block that FK while waiting for the same mutex (account/mutex inversion).
  let settings;
  const expectedRevision=(await first.query("SELECT capacity_sequence::int AS revision FROM reviewer_capacity_revisions WHERE account_id=$1 ORDER BY capacity_sequence DESC LIMIT 1",[reviewer.accountId])).rows[0].revision;
  await first.transaction(async tx=>{
   await tx.query("SELECT account_id FROM reviewer_capacity_locks WHERE account_id=$1 FOR UPDATE",[reviewer.accountId]);
   settings=new ReviewQualityService(second).setCapacity(f.admin,{accountId:reviewer.accountId,maxOpenReviews:1,expectedRevision,reason:"Keep the verified single review limit without blocking producer foreign keys."}).then(()=>({ok:true}),error=>({error}));
   let waiting=false;
   for(let i=0;i<100;i++){
    await tx.query("SELECT pg_stat_clear_snapshot()");
    waiting=Boolean((await tx.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT account_id FROM reviewer_capacity_locks%' ")).rows[0]);
    if(waiting)break;
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert.equal(waiting,true,"settings must reach and wait at the producer-held mutex");
   await tx.query("SELECT account_id FROM auth_accounts WHERE account_id=$1 FOR KEY SHARE NOWAIT",[reviewer.accountId]);
  });
  const settingResult=await settings;assert.equal(settingResult.ok,true,settingResult.error?.message);
  const results=await Promise.allSettled([f.review.claim(reviewer,a.taskId),new EvidenceReviewService(second).claim(reviewer,b.taskId)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/REVIEWER_CAPACITY_REACHED/);
  const rows=(await first.query("SELECT task_id,task_status FROM evidence_review_tasks WHERE task_id=ANY($1::text[])",[[a.taskId,b.taskId]])).rows;
  assert.equal(rows.filter(t=>t.task_status==='ASSIGNED').length,1);assert.equal(rows.filter(t=>t.task_status==='QUEUED').length,1);
  assert.equal((await first.query("SELECT platform_reviewer_open_reviews($1) AS n",[reviewer.accountId])).rows[0].n,1);
  const assigned=rows.find(t=>t.task_status==='ASSIGNED'),queued=rows.find(t=>t.task_status==='QUEUED');
  await f.review.decide(reviewer,assigned.task_id,"APPROVED","The independent source meets the retained observation standard.");
  await new EvidenceReviewService(second).claim(reviewer,queued.task_id);
  console.log("ACTUAL_POSTGRES_TWO_CLIENTS capacity lock prevents overassignment and releases on completion");
 }finally{await first.close();await second.close();await admin.execute('DROP DATABASE "'+name+'"');await admin.close();}
});
