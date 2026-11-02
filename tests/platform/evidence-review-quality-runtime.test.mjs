import assert from "node:assert/strict";
import test from "node:test";
import {reviewQualityFixture} from "../helpers/review-quality-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import {readFileSync} from "node:fs";

test("Pinned required second review retains first intent without authorizing evidence and needs an independent agreement",async()=>{
 const f=await reviewQualityFixture({policyValues:{evidence_second_review_required:true}});
 try{
  const x=await f.queue(),[first,second]=f.verifiers;
  await f.review.claim(first,x.taskId);await f.review.decide(first,x.taskId,"APPROVED","The signed observation independently meets the framework requirements.");
  const primary=(await f.db.query("SELECT task_status,assigned_verifier_account_id FROM evidence_review_tasks WHERE task_id=$1",[x.taskId])).rows[0];
  assert.deepEqual(primary,{task_status:"QUEUED",assigned_verifier_account_id:null});
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_decisions WHERE task_id=$1",[x.taskId])).rows[0].n,0);
  await assert.rejects(f.review.claim(first,x.taskId),/independent|quality|SECOND_REVIEW/i);
  await f.review.claim(second,x.taskId);await f.review.decide(second,x.taskId,"APPROVED","A separate independent check agrees with the observed competency.");
  assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[x.taskId])).rows[0].task_status,"APPROVED");
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_quality_rounds WHERE task_id=$1",[x.taskId])).rows[0].n,2);
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_decisions WHERE task_id=$1",[x.taskId])).rows[0].n,1);
  await assert.rejects(f.db.query("UPDATE evidence_review_quality_rounds SET reason='Replaced reason' WHERE task_id=$1",[x.taskId]),/append-only/);
  await assert.rejects(f.db.execute(readFileSync("database/migrations/0119_evidence_review_quality_controls.down.sql","utf8")),/histories must be retained/);
 }finally{await f.db.close();}
});

test("Independent disagreement reaches Admin and cannot silently verify or reject the source",async()=>{
 const f=await reviewQualityFixture({policyValues:{evidence_second_review_required:true}});
 try{
  const x=await f.queue(),[first,second]=f.verifiers;
  await f.review.claim(first,x.taskId);await f.review.decide(first,x.taskId,"APPROVED","The first reviewer recorded their independent evidence finding.");
  await f.review.claim(second,x.taskId);await f.review.decide(second,x.taskId,"REJECTED","The independent source check disagrees with the first finding.");
  assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[x.taskId])).rows[0].task_status,"ESCALATED");
  assert.equal((await f.db.query("SELECT owner_kind FROM assurance_cases WHERE case_id=$1",[f.caseId])).rows[0].owner_kind,"admin");
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_decisions WHERE task_id=$1",[x.taskId])).rows[0].n,0);
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_quality_rounds WHERE task_id=$1",[x.taskId])).rows[0].n,2);
  const revision=(await f.db.query("SELECT revision FROM evidence_review_resolution_events WHERE task_id=$1 ORDER BY revision DESC LIMIT 1",[x.taskId])).rows[0].revision;
  await assert.rejects(f.review.returnEscalation(f.worker,x.taskId,revision,"Worker must not authorize the adjudicator."));
  await f.review.returnEscalation(f.admin,x.taskId,revision,"Authorize a third independent reviewer to adjudicate the retained disagreement.");
  await assert.rejects(f.review.claim(first,x.taskId),/independent|SECOND_REVIEW/i);
  const third=f.verifiers[2];await f.review.claim(third,x.taskId);await f.review.decide(third,x.taskId,"REJECTED","Third independent adjudication finds the source does not meet the standard.",new Date(),{expectedResolutionRevision:revision+1});
  assert.equal((await f.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[x.taskId])).rows[0].task_status,"REJECTED");
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_quality_rounds WHERE task_id=$1",[x.taskId])).rows[0].n,3);
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_decisions WHERE task_id=$1",[x.taskId])).rows[0].n,1);
 }finally{await f.db.close();}
});

test("Published 100-percent sampling is drawn once and survives a conflict without re-rolling scope",async()=>{
 const f=await reviewQualityFixture({policyValues:{evidence_review_sampling_percent:100}});
 try{
  const x=await f.queue(),[first,second]=f.verifiers;
  await f.review.claim(first,x.taskId);
  const selection=(await f.db.query("SELECT * FROM evidence_review_quality_selections WHERE task_id=$1",[x.taskId])).rows[0];
  assert.equal(selection.sampled,true);assert.equal(selection.sampling_percent,100);
  await f.review.declareConflict(first,x.taskId,"A prior working relationship requires another independent reviewer.");
  await f.review.claim(second,x.taskId);
  assert.deepEqual((await f.db.query("SELECT * FROM evidence_review_quality_selections WHERE task_id=$1",[x.taskId])).rows[0],selection);
  await f.review.decide(second,x.taskId,"APPROVED","The newly assigned reviewer recorded the first independent finding.");
  assert.equal((await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_decisions WHERE task_id=$1",[x.taskId])).rows[0].n,0);
 }finally{await f.db.close();}
});

test("Reasoned Admin selection and explicit capacity govern real claim races without losing queued tasks",async()=>{
 const f=await reviewQualityFixture();
 try{
  const {ReviewQualityService}=loadWorkerRegistrationTs("src/lib/review/review-quality-service.ts");
  const quality=new ReviewQualityService(f.db),[first]=f.verifiers;
  const x=await f.queue("COMP-FIRST"),y=await f.queue("COMP-SECOND");
  await quality.requireSecond(f.admin,{taskId:x.taskId,reason:"This selected high-risk source needs independent second verification."});
  await assert.rejects(quality.requireSecond(f.worker,{taskId:y.taskId,reason:"A Worker cannot select an operational review policy."}));
  await quality.setCapacity(f.admin,{accountId:first.accountId,maxOpenReviews:1,expectedRevision:0,reason:"One active review is the explicit current staffing limit."});
  const race=await Promise.allSettled([f.review.claim(first,x.taskId),f.review.claim(first,y.taskId)]);
  assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
  const current=(await f.db.query("SELECT COUNT(*)::integer n FROM evidence_review_tasks WHERE assigned_verifier_account_id=$1 AND task_status='ASSIGNED'",[first.accountId])).rows[0].n;
  assert.equal(current,1);
  await assert.rejects(quality.setCapacity(f.admin,{accountId:first.accountId,maxOpenReviews:2,expectedRevision:0,reason:"An obsolete staffing form must not overwrite the latest limit."}),/changed|reload/i);
 }finally{await f.db.close();}
});

test("Independent review handoff seals its actor and notifies only current independent calibrated reviewers",async()=>{
 const f=await reviewQualityFixture({policyValues:{evidence_second_review_required:true}});
 try{
  const {applyMigrationsThrough}=await import("../helpers/migration-ceiling.mjs");await applyMigrationsThrough(f.db,"quality-notifications","0120_review_recovery_notifications");
  const x=await f.queue(),[first,second,third]=f.verifiers;
  await f.review.claim(first,x.taskId);await f.review.decide(first,x.taskId,"APPROVED","The first independent review requires a separate qualified verifier.");
  const job=(await f.db.query("SELECT * FROM platform_outbox_jobs WHERE payload->>'eventType'='evidence.second_review.requested'")).rows[0];
  assert.ok(job);assert.equal(job.enqueued_by_account_id,first.accountId);
  const recipients=(await f.db.query("SELECT * FROM platform_assurance_event_recipients($1,$2)",[job.payload.eventType,job.payload.eventRef])).rows;
  assert.deepEqual(recipients.map(r=>r.account_id).sort(),[second.accountId,third.accountId].sort());
  assert.ok(recipients.every(r=>r.target_key==='verifier.review.task'&&r.target_reference===x.taskId));
  await f.review.claim(second,x.taskId);
  assert.equal((await f.db.query("SELECT * FROM platform_assurance_event_recipients($1,$2)",[job.payload.eventType,job.payload.eventRef])).rows.length,0);
  await f.review.declareConflict(second,x.taskId,"A new disclosed relationship removes the second reviewer.");
  await f.review.declareConflict(first,x.taskId,"The first reviewer has now disclosed a disqualifying conflict.");
  assert.equal((await f.db.query("SELECT * FROM platform_assurance_event_recipients($1,$2)",[job.payload.eventType,job.payload.eventRef])).rows.length,0,"An invalidated primary round must never revive its old handoff");
  await f.review.claim(third,x.taskId);await f.review.decide(third,x.taskId,"APPROVED","Replacement first independent finding after the disclosed conflicts.");
  assert.equal((await f.db.query("SELECT * FROM platform_assurance_event_recipients($1,$2)",[job.payload.eventType,job.payload.eventRef])).rows.length,0,"Replacement first-round audit must not revive the old primary handoff");
  await assert.rejects(f.db.execute(readFileSync("database/migrations/0120_review_recovery_notifications.down.sql","utf8")),/histories must be retained/);
 }finally{await f.db.close();}
});

test("Review quality policy rejects malformed sampling and non-boolean requirements",()=>{
 const {reviewQualityPolicy}=loadWorkerRegistrationTs("src/lib/review/review-quality-domain.ts");
 assert.deepEqual(reviewQualityPolicy({}),{requireSecond:false,samplingPercent:0});
 for(const value of [-1,101,1.5,"25",null])assert.throws(()=>reviewQualityPolicy({evidence_review_sampling_percent:value}));
 for(const value of ["true",1,null])assert.throws(()=>reviewQualityPolicy({evidence_second_review_required:value}));
});

test("Empty quality notification migration rolls back in order and restores exact prior wrappers",async()=>{
 const f=await reviewQualityFixture();
 try{
  const {applyMigrationsThrough}=await import("../helpers/migration-ceiling.mjs");
  const definitions=async()=>(await f.db.query("SELECT pg_get_functiondef('platform_assurance_event_source(text,text)'::regprocedure) source,pg_get_functiondef('platform_assurance_event_recipients(text,text)'::regprocedure) recipients")).rows[0];
  const before=await definitions();await applyMigrationsThrough(f.db,"quality-empty-rollback","0120_review_recovery_notifications");
  await f.db.execute(readFileSync("database/migrations/0120_review_recovery_notifications.down.sql","utf8"));assert.deepEqual(await definitions(),before);
  await f.db.execute(readFileSync("database/migrations/0119_evidence_review_quality_controls.down.sql","utf8"));
  await f.db.execute(readFileSync("database/migrations/0119_evidence_review_quality_controls.up.sql","utf8"));
  await f.db.execute(readFileSync("database/migrations/0120_review_recovery_notifications.up.sql","utf8"));
 }finally{await f.db.close();}
});
