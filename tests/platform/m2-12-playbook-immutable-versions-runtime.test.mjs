import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {policyInterview} from "../helpers/interview-policy-fixture.mjs";
test("M2.12.02 configured mandatory and approved follow-up versions retain exact immutable history",{timeout:120000},async()=>{
 const x=await policyInterview({start:false});
 try{
  const id=x.request.interviewRequestId;
  const rows=()=>x.database.query("SELECT question_set_id,version_no,questions_json,source_context_json,created_by_account_id,created_at FROM interview_question_sets WHERE interview_request_id=$1 ORDER BY version_no",[id]);
  const first=(await rows()).rows;assert.equal(first.length,1);assert.equal(first[0].version_no,1);
  const v1=structuredClone(first[0]);
  assert.ok(x.set.questions.some(q=>q.kind==="MANDATORY"&&q.templateId==="controls"));
  assert.ok(x.set.questions.some(q=>q.kind==="HIGH_RISK"&&q.templateId==="safety"));
  assert.equal(x.set.sourceContext.policyVersionId,x.published);
  assert.deepEqual(await x.playbook.getAssigned(x.principal,id),x.set);
  assert.deepEqual(await x.playbook.ensure(x.principal,id),x.set);
  await assert.rejects(x.playbook.addFollowUp({...x.principal,activeRole:"worker"},id,"follow"),/access|assessor/i);
  await assert.rejects(x.playbook.addFollowUp(x.principal,id,"other-unapproved-prompt"),/approved/i);
  assert.equal((await rows()).rows.length,1,"invalid follow-ups cannot write versions");
  const second=await x.playbook.addFollowUp(x.principal,id,"follow");assert.equal(second.versionNo,2);
  assert.notEqual(second.questionSetId,x.set.questionSetId);
  assert.equal(second.questions.length,x.set.questions.length+1);
  assert.deepEqual(second.questions.slice(0,-1),x.set.questions);
  assert.equal(second.questions.at(-1).templateId,"follow");assert.equal(second.questions.at(-1).source,"effective_policy");
  assert.deepEqual(second.sourceContext.selectedTemplateIds,second.questions.map(q=>q.templateId));
  assert.deepEqual(second.sourceContext.interviewPolicy,x.set.sourceContext.interviewPolicy);
  await assert.rejects(x.playbook.addFollowUp(x.principal,id,"follow"),/unused approved follow-up/i);
  assert.deepEqual(await x.playbook.ensure(x.principal,id),second);
  const persisted=(await rows()).rows;assert.equal(persisted.length,2);assert.deepEqual(persisted[0],v1);
  assert.equal(persisted[1].version_no,2);
  assert.deepEqual(await x.playbook.getAssigned(x.principal,id),second);
  await assert.rejects(x.database.transaction(async tx=>{await tx.query("UPDATE interview_question_sets SET questions_json='[]'::jsonb WHERE question_set_id=$1",[v1.question_set_id]);}),/append.only|immutable|history/i,"old question history may never be rewritten");
  await assert.rejects(x.database.transaction(async tx=>{await tx.query("DELETE FROM interview_question_sets WHERE question_set_id=$1",[v1.question_set_id]);}),/append.only|immutable|history/i,"old question history may never be erased");
  assert.deepEqual((await rows()).rows,persisted);
  // A separate downgrade must remove only its guard; re-up must restore
  // immutability without changing or discarding any question set version.
  const down=readFileSync("database/migrations/0128_interview_playbook_append_only.down.sql","utf8");
  const up=readFileSync("database/migrations/0128_interview_playbook_append_only.up.sql","utf8");
  await x.database.exec(down);
  assert.equal((await x.database.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='interview_question_sets_append_only' AND NOT tgisinternal")).rows[0].n,0);
  assert.deepEqual((await rows()).rows,persisted,"Down migration may not delete or rewrite historical questions");
  await x.database.exec(up);
  assert.equal((await x.database.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='interview_question_sets_append_only' AND NOT tgisinternal")).rows[0].n,1);
  await assert.rejects(x.database.transaction(async tx=>tx.query("DELETE FROM interview_question_sets WHERE question_set_id=$1",[v1.question_set_id])),/append.only/i);
  assert.deepEqual((await rows()).rows,persisted);
  console.log("ACTUAL_M21202_NATIVE configured mandatory/random/high risk selected and frozen; approved follow-up version 2 retains exact version 1, invalid/duplicate/role denied, direct UPDATE and DELETE immutable.");
 }finally{await x.cleanup();}
});
