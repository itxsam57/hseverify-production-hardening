import assert from "node:assert/strict";
import test from "node:test";
import {resolve} from "node:path";
import { accommodationDeliveryFixture } from "../helpers/accommodation-delivery-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
const at=(c,seconds)=>new Date(c.now.getTime()+seconds*1000);

test("approved 1.5 delivery reaches the real attempt producer and immutable 450-second Worker clock",async()=>{
 const c=await accommodationDeliveryFixture({seed:"time"});
 try{
  assert.equal(c.begun.timing.remainingSeconds,450);
  const policy=(await c.db.query("SELECT time_multiplier,phase_durations_json FROM assessment_attempt_time_policies WHERE attempt_id=$1",[c.begun.attempt.attemptId])).rows[0];
  assert.equal(Number(policy.time_multiplier),1.5);assert.deepEqual(policy.phase_durations_json,[450]);
  await c.approve(c.seeded.caseId,"later_time",{timeMultiplier:2,extraBreakMinutes:60});
  const view=await c.service.getOwnedView(c.worker,c.begun.attempt.attemptId,at(c,10),null);
  assert.equal(view.timing.remainingSeconds,440,"later approvals must not silently change an active timer");
  await assert.rejects(c.db.query("UPDATE assessment_attempt_time_policies SET time_multiplier=2 WHERE attempt_id=$1",[view.attempt.attemptId]),/append-only/);
 }finally{await c.cleanup();}
});

test("approved finite break hides questions and denies real writes until the server-owned end",async()=>{
 const c=await accommodationDeliveryFixture({seed:"break"});
 try{
  assert.equal(typeof c.service.startApprovedBreak,"function","approved break has no operative assessment consumer");
  const attemptId=c.begun.attempt.attemptId,input={attemptId,durationSeconds:60,mutationKey:"approved_break_delivery_0001"};
  const paused=await c.service.startApprovedBreak(c.worker,input,null,at(c,10));
  assert.equal(paused.currentQuestion,null);assert.equal(paused.currentDraft,null);
  assert.equal(paused.accommodationBreak.active,true);assert.equal(paused.accommodationBreak.remainingAllowanceSeconds,60);
  assert.equal(paused.accommodationBreak.endsAt,at(c,70).toISOString());
  assert.equal(paused.timing.deadlineAt,at(c,510).toISOString());
  const retry=await c.service.startApprovedBreak(c.worker,input,null,at(c,11));
  assert.equal(retry.accommodationBreak.endsAt,paused.accommodationBreak.endsAt);
  await assert.rejects(c.service.startApprovedBreak(c.worker,{...input,mutationKey:"overlap_break_delivery_0002"},null,at(c,12)),/break.*active|already.*break/i);
  await assert.rejects(c.service.startApprovedBreak(c.foreign,input,null,at(c,12)),/access|denied|available/i);
  const question=c.begun.currentQuestion;
  await assert.rejects(c.service.saveCurrentDraft(c.worker,{attemptId,position:question.position,questionVersionId:question.questionVersionId,value:"Alpha",expectedRevision:null,mutationKey:"paused_draft_delivery_0001"},at(c,12),null),/break/i);
  await assert.rejects(c.service.submitCurrentAnswer(c.worker,{attemptId,position:question.position,questionVersionId:question.questionVersionId,answer:"Alpha"},at(c,12),null),/break/i);
  const active=await c.service.getOwnedView(c.worker,attemptId,at(c,70),null);
  assert.ok(active.currentQuestion);assert.equal(active.accommodationBreak.active,false);
  assert.equal(active.timing.remainingSeconds,440);
  await assert.rejects(c.service.startApprovedBreak(c.worker,{...input,durationSeconds:61,mutationKey:"overspend_break_delivery_0001"},null,at(c,71)),/allowance|budget/i);
  await c.service.startApprovedBreak(c.worker,{...input,durationSeconds:60,mutationKey:"second_break_delivery_0001"},null,at(c,71));
  const history=await c.db.query("SELECT duration_seconds FROM assessment_accommodation_breaks WHERE attempt_id=$1",[attemptId]);
  assert.deepEqual(history.rows.map(x=>Number(x.duration_seconds)),[60,60]);
  await assert.rejects(c.db.query("DELETE FROM assessment_accommodation_breaks WHERE attempt_id=$1",[attemptId]),/append-only/);
 }finally{await c.cleanup();}
});

test("extended server expiry ignores the old deadline and closes only at the reserved deadline",async()=>{
 const c=await accommodationDeliveryFixture({seed:"expiry"});
 try{
  const attemptId=c.begun.attempt.attemptId,{bindTrustedSystemAuditActor}=loadTs(resolve("src/lib/audit/audit-domain.ts"));
  const actor=bindTrustedSystemAuditActor("outbox-worker");
  const before=(await c.db.query("SELECT payload FROM platform_outbox_jobs WHERE job_type='assessment.attempt.expiry' AND payload->>'attemptRef'=$1",[attemptId])).rows[0].payload;
  await c.service.startApprovedBreak(c.worker,{attemptId,durationSeconds:60,mutationKey:"expiry_break_delivery_0001"},null,at(c,10));
  const jobs=(await c.db.query("SELECT payload,next_attempt_at FROM platform_outbox_jobs WHERE job_type='assessment.attempt.expiry' AND payload->>'attemptRef'=$1 ORDER BY next_attempt_at",[attemptId])).rows;
  const adjusted=jobs.at(-1).payload;
  assert.equal(adjusted.deadlineAt,at(c,510).toISOString());assert.equal(new Date(jobs.at(-1).next_attempt_at).toISOString(),adjusted.deadlineAt);
  await c.service.processExpiry(before,c.worker.accountId,actor,at(c,450));
  assert.equal((await c.service.getOwnedView(c.worker,attemptId,at(c,450),null)).attempt.status,"IN_PROGRESS");
  await c.service.processExpiry(adjusted,c.worker.accountId,actor,at(c,509));
  assert.equal((await c.service.getOwnedView(c.worker,attemptId,at(c,509),null)).attempt.status,"IN_PROGRESS");
  await c.service.processExpiry(adjusted,c.worker.accountId,actor,at(c,510));
  const done=await c.service.getOwnedView(c.worker,attemptId,at(c,510),null);assert.equal(done.attempt.status,"AUTO_SUBMITTED");assert.equal(done.currentQuestion,null);
  await c.service.processExpiry(adjusted,c.worker.accountId,actor,at(c,511));
  assert.equal((await c.service.getOwnedView(c.worker,attemptId,at(c,511),null)).attempt.status,"AUTO_SUBMITTED");
 }finally{await c.cleanup();}
});

test("separate phases share one approved break budget and rest denies review, progression and revoked sessions",async()=>{
 const c=await accommodationDeliveryFixture({seed:"phases",separate:true});
 try{
  const attemptId=c.begun.attempt.attemptId,question=c.begun.currentQuestion;
  await c.service.submitCurrentAnswer(c.worker,{attemptId,position:question.position,answer:question.options[0]},at(c,1),null);
  const paused=await c.service.startApprovedBreak(c.worker,{attemptId,durationSeconds:60,mutationKey:"phases_break_delivery_0001"},null,at(c,10));
  assert.deepEqual(paused.reviewablePositions,[]);assert.equal(paused.timing.deadlineAt,at(c,285).toISOString());
  await assert.rejects(c.service.getReviewQuestion(c.worker,attemptId,1,null,at(c,11)),/break/i);
  await assert.rejects(c.service.reviseCommittedAnswer(c.worker,{attemptId,position:1,answer:question.options[1]},null,at(c,11)),/break/i);
  await assert.rejects(c.service.setReviewFlag(c.worker,{attemptId,position:1,flagged:true},null,at(c,11)),/break/i);
  await assert.rejects(c.service.advanceSection(c.worker,attemptId,null,at(c,11)),/break/i);
  const next=await c.service.advanceSection(c.worker,attemptId,null,at(c,70));
  assert.equal(next.timing.phaseIndex,2);assert.equal(next.accommodationBreak.remainingAllowanceSeconds,60);
  await c.service.startApprovedBreak(c.worker,{attemptId,durationSeconds:60,mutationKey:"phases_break_delivery_0002"},null,at(c,80));
  const resumed=await c.service.getOwnedView(c.worker,attemptId,at(c,140),null);assert.equal(resumed.accommodationBreak.remainingAllowanceSeconds,0);
  await assert.rejects(c.service.startApprovedBreak(c.worker,{attemptId,durationSeconds:1,mutationKey:"phases_break_delivery_0003"},null,at(c,141)),/allowance/i);
  await c.db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='controlled_fixture_revocation' WHERE session_id=$1",[c.worker.sessionId,at(c,141).toISOString()]);
  await assert.rejects(c.service.startApprovedBreak(c.worker,{attemptId,durationSeconds:1,mutationKey:"revoked_break_delivery_0001"},null,at(c,142)),/access|available|session/i);
 }finally{await c.cleanup();}
});


test("approved adjustment increases delivery time but cannot lower the pinned objective pass mark",async()=>{
 const c=await accommodationDeliveryFixture({seed:"objective_standard",passMark:75});
 try{
  const id=c.begun.attempt.attemptId;
  assert.equal(c.begun.timing.remainingSeconds,450);
  const snapshot=(await c.db.query("SELECT effective_value_json FROM assurance_case_policy_snapshots WHERE case_id=$1",[c.seeded.caseId])).rows[0];
  assert.equal(snapshot.effective_value_json.pass_mark,75);
  const first=c.begun.currentQuestion;
  assert.ok(first.options.includes("Alpha"));
  const next=await c.service.submitCurrentAnswer(c.worker,{attemptId:id,position:1,questionVersionId:first.questionVersionId,answer:"Alpha"},at(c,10),null);
  assert.equal(next.currentQuestion.position,2);
  assert.ok(next.currentQuestion.options.includes("Bravo"));
  await c.service.submitCurrentAnswer(c.worker,{attemptId:id,position:2,questionVersionId:next.currentQuestion.questionVersionId,answer:"Bravo"},at(c,20),null);
  const submitted=await c.service.finalizeAssessment(c.worker,id,null,at(c,25));
  assert.equal(submitted.submitted,true);
  const score=(await c.db.query("SELECT score,decision,status,reason FROM written_score_reviews WHERE attempt_id=$1",[id])).rows;
  assert.equal(score.length,1);
  assert.equal(Number(score[0].score),50);
  assert.equal(score[0].decision,"FAIL");
  assert.equal(score[0].status,"FINAL");
  assert.match(score[0].reason,/pass mark 75/);
  const caseState=(await c.db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[c.seeded.caseId])).rows[0];
  assert.equal(caseState.case_status,"Reassessment required");
  const immutable=(await c.db.query("SELECT time_multiplier FROM assessment_attempt_time_policies WHERE attempt_id=$1",[id])).rows[0];
  assert.equal(Number(immutable.time_multiplier),1.5);
  assert.equal((await c.db.query("SELECT effective_value_json FROM assurance_case_policy_snapshots WHERE case_id=$1",[c.seeded.caseId])).rows[0].effective_value_json.pass_mark,75);
 }finally{await c.cleanup();}
});
