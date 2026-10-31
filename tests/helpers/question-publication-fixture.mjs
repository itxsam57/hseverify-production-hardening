import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";
const { QuestionBankService }=loadWorkerRegistrationTs("src/lib/question-bank/question-bank-service.ts");

// Test data only. These rows exercise the real SQL lifecycle guards, not a
// production flag, legacy provenance, or an ACTIVE-without-approval fallback.
const hash = value => createHash("sha256").update(value).digest("hex");
export async function hasQuestionApprovalLifecycle(database) {
  const result = await database.query("SELECT to_regclass('question_version_workflow') IS NOT NULL AS installed");
  return result.rows[0].installed;
}
export async function seedQuestionFixtureAdmin(database, accountId, now = new Date().toISOString()) {
  const sessionId = "question_fixture_session_" + hash(accountId).slice(0,24);
  const email = "question-fixture-" + hash(accountId).slice(0,24) + "@example.test";
  await database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,'Question fixture Admin','active','scrypt$16384$8$1$salt$hash',$3,$3,$3,$3) ON CONFLICT(account_id) DO NOTHING",[accountId,email,now]);
  const existing = await database.query("SELECT role FROM auth_account_roles WHERE account_id=$1",[accountId]);
  assert.ok(!existing.rows.some(row => row.role === "worker"), "Question fixture must never grant Admin to a Worker author");
  await database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2) ON CONFLICT DO NOTHING",[accountId,now]);
  await database.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'admin',$3,$4,$5,$5,'2099-01-01') ON CONFLICT(session_id) DO NOTHING",[sessionId,accountId,hash("token:"+sessionId),hash("csrf:"+sessionId),now]);
  return {accountId,sessionId,activeRole:"admin",accountStatus:"active",tenantMembership:null,authorizedPlatformPermission:"platform.operations.manage"};
}

export async function seedPublishedQuestion(database, input) {
  assert.equal(await hasQuestionApprovalLifecycle(database),true,"Current fixture requires question lifecycle migration0103");
  const now = input.now ?? new Date().toISOString();
  const authorId = input.authorAccountId ?? "question_fixture_author_" + hash(input.questionId).slice(0,24);
  const reviewerId = "question_fixture_reviewer_" + hash(authorId).slice(0,24);
  assert.notEqual(authorId,reviewerId);
  const author = await seedQuestionFixtureAdmin(database,authorId,now);
  const reviewer = await seedQuestionFixtureAdmin(database,reviewerId,now);
  await database.transaction(async tx => {
    if(input.exposureFamilyReference) await tx.query("INSERT INTO assessment_questions(question_id,question_reference,exposure_family_reference,question_status,current_version_id,current_content_fingerprint,created_by_account_id,created_at,updated_at) VALUES($1,$2,$3,'INACTIVE',NULL,NULL,$4,$5,$5)",[input.questionId,input.reference,input.exposureFamilyReference,authorId,now]);
    else await tx.query("INSERT INTO assessment_questions(question_id,question_reference,question_status,current_version_id,current_content_fingerprint,created_by_account_id,created_at,updated_at) VALUES($1,$2,'INACTIVE',NULL,NULL,$3,$4,$4)",[input.questionId,input.reference,authorId,now]);
    await tx.query("INSERT INTO assessment_question_versions(question_version_id,question_id,version_no,question_type,prompt,options_json,answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,content_fingerprint,created_by_account_id,created_at) VALUES($1,$2,1,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$13,$14)",[input.versionId,input.questionId,input.questionType,input.prompt,input.options == null?null:JSON.stringify(input.options),input.answerKey == null?null:JSON.stringify(input.answerKey),input.rubric == null?null:JSON.stringify(input.rubric),input.frameworkId,input.domainReference??"Core",input.difficulty??"MEDIUM",JSON.stringify(input.tags??[]),input.fingerprint,authorId,now]);
    await tx.query("UPDATE assessment_questions SET authoring_version_id=$2,current_version_id=$2,current_content_fingerprint=$3 WHERE question_id=$1",[input.questionId,input.versionId,input.fingerprint]);
  });
  const service=new QuestionBankService(database);
  let item=(await service.listQuestions(author)).find(row=>row.question.questionId===input.questionId);
  assert.equal(item.workflow.state,"DRAFT");
  for(const [action,actor] of [["SUBMIT",author],["APPROVE",reviewer],["PUBLISH",reviewer]]) {
    item=await service.transitionQuestion(actor,{questionId:input.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,expectedWorkflowState:item.workflow.state,expectedRevisionNo:item.workflow.revisionNo,action},new Date(now));
  }
  const workflow = await database.query("SELECT workflow_state,author_account_id,approved_by_account_id,provenance FROM question_version_workflow WHERE question_version_id=$1",[input.versionId]);
  assert.deepEqual(workflow.rows[0],{workflow_state:"PUBLISHED",author_account_id:authorId,approved_by_account_id:reviewerId,provenance:"AUTHORED"});
  return {questionId:input.questionId,questionVersionId:input.versionId,author,reviewer};
}

export async function revisePublishedFixtureQuestion(database,question,version,now) {
 const service=new QuestionBankService(database);
 let item=(await service.listQuestions(question.author)).find(row=>row.question.questionId===question.questionId);
 item=await service.reviseQuestion(question.author,{questionId:question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,version},new Date(now));
 for(const [action,actor] of [["SUBMIT",question.author],["APPROVE",question.reviewer],["PUBLISH",question.reviewer]]) {
  item=await service.transitionQuestion(actor,{questionId:question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,expectedWorkflowState:item.workflow.state,expectedRevisionNo:item.workflow.revisionNo,action},new Date(now));
 }
 return item.version.questionVersionId;
}
