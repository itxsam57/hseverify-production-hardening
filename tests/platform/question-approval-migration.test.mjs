import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {loadQuestionBankSource} from "../helpers/question-bank-direct-runtime-loader.mjs";
const NOW_DATE = new Date("2026-08-18T02:10:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-04-question-bank-runtime",
  sessionSecret: "m2-04-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-04-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function seedAdmin(database, c, { revoked = false } = {}) {
  const accountId = `account_m204_admin_${c}`;
  const sessionId = `session_m204_admin_${c}`;
  const email = `admin-m204-${c.toLowerCase()}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, `Admin ${c}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions(
       session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,
       last_seen_at,expires_at,revoked_at,revocation_reason
     ) VALUES($1,$2,'admin',$3,$4,$5,$5,$6,$7,$8)`,
    [
      sessionId,
      accountId,
      `token-${c}`,
      `csrf-${c}`,
      NOW,
      FUTURE,
      revoked ? NOW : null,
      revoked ? "runtime_fixture_revoked" : null
    ]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: "admin",
    accountStatus: "active",
    email,
    displayName: `Admin ${c}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null,
    authorizedPlatformPermission: "platform.operations.manage"
  });
}

async function seedFramework(database, c) {
  const id = oid("framework", c);
  await database.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$5)`,
    [id, `FRAME-${c}`, `Framework ${c}`, `account_seed_${c}`, NOW]
  );
  return { frameworkId: id, frameworkReference: `FRAME-${c}` };
}


const {QuestionBankService}=loadQuestionBankSource("src/lib/question-bank/question-bank-service.ts");
const MIGRATION="0103_question_approval_lifecycle";
const up=readFileSync("database/migrations/"+MIGRATION+".up.sql","utf8");
const down=readFileSync("database/migrations/"+MIGRATION+".down.sql","utf8");
async function databaseThrough(id=MIGRATION){const database=await openScriptDatabase(ENV);await applyMigrationsThrough(database,ENV.releaseSha,id);return database;}
async function seedQuestion(database,author,framework,character,versionNo=1){
 const questionId=oid("assessment_question",character),versionId=oid("question_version",character),fingerprint=character.toLowerCase().repeat(64);
 await database.transaction(async tx=>{
 if(versionNo===1)await tx.query("INSERT INTO assessment_questions(question_id,question_reference,created_by_account_id) VALUES($1,$2,$3)",[questionId,"MIGRATION-"+character,author.accountId]);
 await tx.query("INSERT INTO assessment_question_versions(question_version_id,question_id,version_no,question_type,prompt,answer_key_json,framework_id,domain_reference,difficulty,content_fingerprint,created_by_account_id) VALUES($1,$2,$3,'TRUE_FALSE','Safety question requiring independent approval','true'::jsonb,$4,'Safety','MEDIUM',$5,$6)",[versionId,questionId,versionNo,framework.frameworkId,fingerprint,author.accountId]);
 const installed=(await tx.query("SELECT to_regclass('question_version_workflow') AS name")).rows[0].name;
 if(installed)await tx.query("UPDATE assessment_questions SET current_version_id=$2,authoring_version_id=$2,current_content_fingerprint=$3 WHERE question_id=$1",[questionId,versionId,fingerprint]);
 else await tx.query("UPDATE assessment_questions SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE' WHERE question_id=$1",[questionId,versionId,fingerprint]);
 });
 return{questionId,versionId,fingerprint};
}
test("Question approval migration empty down/up is reversible without CASCADE",async()=>{
 const database=await databaseThrough();
 try{
 await database.execute(down);
 assert.equal((await database.query("SELECT to_regclass('question_version_workflow') AS name")).rows[0].name,null);
 assert.equal((await database.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname LIKE 'question_workflow%' OR tgname IN ('question_pointer_guard','question_publication_consistency','question_version_draft')")).rows[0].count,0);
 await database.execute(up);
 assert.ok((await database.query("SELECT to_regclass('question_version_workflow_events') AS name")).rows[0].name);
 assert.doesNotMatch(down,/CASCADE/i);
 }finally{await database.close();}
});
test("Question approval migration imports legacy history without fabricating reviewer and refuses populated rollback",async()=>{
 const database=await databaseThrough("0102_explicit_verified_trade");
 try{
 const author=await seedAdmin(database,"A"),framework=await seedFramework(database,"A"),question=await seedQuestion(database,author,framework,"A");
 await database.query("INSERT INTO assessment_question_versions(question_version_id,question_id,version_no,question_type,prompt,answer_key_json,framework_id,domain_reference,difficulty,content_fingerprint,created_by_account_id) VALUES($1,$2,2,'TRUE_FALSE','Historical replacement remains an immutable legacy record','false'::jsonb,$3,'Safety','MEDIUM',$4,$5)",[oid("question_version","B"),question.questionId,framework.frameworkId,"b".repeat(64),author.accountId]);
 const paused=await seedQuestion(database,author,framework,"C");await database.query("UPDATE assessment_questions SET question_status='INACTIVE' WHERE question_id=$1",[paused.questionId]);
 await database.execute(up);
 const rows=(await database.query("SELECT question_version_id,workflow_state,provenance,approved_by_account_id,approved_at FROM question_version_workflow ORDER BY question_version_id")).rows;
 assert.equal(rows.find(row=>row.question_version_id===question.versionId).workflow_state,"PUBLISHED");
 assert.equal(rows.find(row=>row.question_version_id===oid("question_version","B")).workflow_state,"ARCHIVED");
 assert.equal(rows.find(row=>row.question_version_id===paused.versionId).workflow_state,"PAUSED");
 for(const row of rows){assert.equal(row.provenance,"LEGACY_IMPORTED");assert.equal(row.approved_by_account_id,null);assert.equal(row.approved_at,null);}
 assert.equal((await database.query("SELECT authoring_version_id FROM assessment_questions WHERE question_id=$1",[question.questionId])).rows[0].authoring_version_id,question.versionId);
 await assert.rejects(database.execute(down),{code:"55000"});
 assert.equal((await database.query("SELECT count(*)::int AS count FROM question_version_workflow_events")).rows[0].count,3);
 const reviewer=await seedAdmin(database,"B"),service=new QuestionBankService(database);
 let item=await service.reviseQuestion(author,{questionId:question.questionId,expectedAuthoringVersionId:question.versionId,version:{questionType:"TRUE_FALSE",prompt:"Legacy publication revised into independently approved current safety material",answerKey:true,frameworkReference:framework.frameworkReference,domainReference:"Safety",difficulty:"MEDIUM"}},NOW_DATE);
 assert.equal(item.version.versionNo,3);
 assert.equal(item.question.currentVersionId,question.versionId);
 assert.equal(item.workflow.state,"DRAFT");
 for(const [actor,action] of [[author,"SUBMIT"],[reviewer,"APPROVE"],[author,"PUBLISH"]]){
 item=await service.transitionQuestion(actor,{questionId:question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,expectedWorkflowState:item.workflow.state,expectedRevisionNo:item.workflow.revisionNo,action},NOW_DATE);
 }
 assert.equal(item.question.currentVersionId,item.version.questionVersionId);
 assert.equal(item.workflow.approvedByAccountId,reviewer.accountId);
 assert.equal(item.workflow.provenance,"AUTHORED");
 assert.equal(item.history.find(entry=>entry.version.questionVersionId===question.versionId).workflow.state,"PAUSED");
 const retainedLegacy=(await database.query("SELECT approved_by_account_id,provenance FROM question_version_workflow WHERE question_version_id=$1",[question.versionId])).rows[0];
 assert.equal(retainedLegacy.approved_by_account_id,null);assert.equal(retainedLegacy.provenance,"LEGACY_IMPORTED");

 }finally{await database.close();}
});
test("Question approval direct SQL cannot self-review, activate unapproved content, tamper event or change approved provenance",async()=>{
 const database=await databaseThrough();
 try{
 const author=await seedAdmin(database,"A"),reviewer=await seedAdmin(database,"B"),framework=await seedFramework(database,"A"),question=await seedQuestion(database,author,framework,"A");
 const move=(actor,state,approval=false)=>database.query("UPDATE question_version_workflow SET workflow_state=$2,transition_actor_account_id=$3,transition_session_id=$4,approved_by_account_id=CASE WHEN $5 THEN $3 ELSE approved_by_account_id END,approved_at=CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE approved_at END WHERE question_version_id=$1",[question.versionId,state,actor.accountId,actor.sessionId,approval]);
 await assert.rejects(database.query("UPDATE assessment_questions SET question_status='ACTIVE' WHERE question_id=$1",[question.questionId]),{code:"23514"});
 await move(author,"UNDER_REVIEW");
 await assert.rejects(move(author,"APPROVED",true),{code:"23514"});
 await assert.rejects(move(reviewer,"PUBLISHED"),{code:"23514"});
 await assert.rejects(database.query("INSERT INTO question_version_workflow_events(question_version_id,to_state,revision_no,provenance) VALUES($1,'APPROVED',99,'AUTHORED')",[question.versionId]),{code:"55000"});
 await assert.rejects(database.query("UPDATE question_version_workflow_events SET reason='forged' WHERE question_version_id=$1",[question.versionId]),{code:"55000"});
 await database.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='test_revocation' WHERE session_id=$1",[reviewer.sessionId]);
 await assert.rejects(move(reviewer,"APPROVED",true),{code:"42501"});
 await database.query("UPDATE auth_sessions SET revoked_at=NULL,revocation_reason=NULL WHERE session_id=$1",[reviewer.sessionId]);
 await move(reviewer,"APPROVED",true);
 await assert.rejects(database.query("UPDATE question_version_workflow SET approved_at=approved_at+interval '1 second',workflow_state='PUBLISHED',transition_actor_account_id=$2,transition_session_id=$3 WHERE question_version_id=$1",[question.versionId,author.accountId,author.sessionId]),{code:"55000"});
 await database.transaction(async tx=>{
 await tx.query("UPDATE question_version_workflow SET workflow_state='PUBLISHED',transition_actor_account_id=$2,transition_session_id=$3 WHERE question_version_id=$1",[question.versionId,author.accountId,author.sessionId]);
 await tx.query("UPDATE assessment_questions SET question_status='ACTIVE' WHERE question_id=$1",[question.questionId]);
 });
 assert.equal((await database.query("SELECT count(*)::int AS count FROM question_version_workflow_events WHERE question_version_id=$1",[question.versionId])).rows[0].count,4);
 }finally{await database.close();}
});

test("Archiving newer draft restores published authoring without resurrecting retired history",async()=>{
 const database=await databaseThrough();
 try{
 const author=await seedAdmin(database,"A"),reviewer=await seedAdmin(database,"B"),framework=await seedFramework(database,"A"),service=new QuestionBankService(database);
 const payload=prompt=>({questionType:"TRUE_FALSE",prompt,answerKey:true,frameworkReference:framework.frameworkReference,domainReference:"Safety",difficulty:"MEDIUM"});
 let item=await service.createQuestion(author,{questionReference:"ARCHIVE-RESTORE",version:payload("First independently approved safety question remains live")},NOW_DATE);
 const move=async(actor,action,reason)=>{item=await service.transitionQuestion(actor,{questionId:item.question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,expectedWorkflowState:item.workflow.state,expectedRevisionNo:item.workflow.revisionNo,action,reason},NOW_DATE);};
 await move(author,"SUBMIT");await move(reviewer,"APPROVE");await move(author,"PUBLISH");
 const published=item.version.questionVersionId;
 item=await service.reviseQuestion(author,{questionId:item.question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,version:payload("Second unnecessary draft can be archived without removing live content")},NOW_DATE);
 const discarded=item.version.questionVersionId;
 await move(author,"ARCHIVE");
 assert.equal(item.question.authoringVersionId,published);assert.equal(item.workflow.state,"PUBLISHED");
 assert.equal(item.history.find(row=>row.version.questionVersionId===discarded).workflow.state,"ARCHIVED");
 item=await service.reviseQuestion(author,{questionId:item.question.questionId,expectedAuthoringVersionId:published,version:payload("Third fresh draft must receive new independent review")},NOW_DATE);
 assert.equal(item.version.versionNo,3);
 await move(author,"SUBMIT");await move(reviewer,"APPROVE");await move(author,"PUBLISH");
 await move(author,"RETIRE","Content is retired by a recorded curriculum decision.");await move(author,"ARCHIVE");
 assert.equal(item.workflow.state,"ARCHIVED");
 await assert.rejects(service.reviseQuestion(author,{questionId:item.question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,version:payload("Terminal archived current version must not silently reopen")},NOW_DATE),{name:"QuestionBankConflictError"});
 await assert.rejects(database.query("UPDATE assessment_questions SET authoring_version_id=$2 WHERE question_id=$1",[item.question.questionId,published]),{code:"23514"});
 }finally{await database.close();}
});

test("Archiving a stack of newer drafts restores latest retained Draft or Changes Requested authoring",async()=>{
 const database=await databaseThrough();
 try{
 const author=await seedAdmin(database,"A"),reviewer=await seedAdmin(database,"B"),framework=await seedFramework(database,"A"),service=new QuestionBankService(database);
 const payload=prompt=>({questionType:"TRUE_FALSE",prompt,answerKey:true,frameworkReference:framework.frameworkReference,domainReference:"Safety",difficulty:"MEDIUM"});
 let item=await service.createQuestion(author,{questionReference:"DRAFT-STACK",version:payload("First safety question remains a published stable pointer")},NOW_DATE);
 const move=async(actor,action,reason)=>{item=await service.transitionQuestion(actor,{questionId:item.question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,expectedWorkflowState:item.workflow.state,expectedRevisionNo:item.workflow.revisionNo,action,reason},NOW_DATE);};
 await move(author,"SUBMIT");await move(reviewer,"APPROVE");await move(author,"PUBLISH");
 const live=item.version.questionVersionId;
 const revise=async(prompt)=>{item=await service.reviseQuestion(author,{questionId:item.question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,version:payload(prompt)},NOW_DATE);};
 await revise("Second safety draft awaits independent review and remains unpublished");
 const draft=item.version.questionVersionId;
 await revise("Third safety draft may be archived while the prior draft is retained");
 const newest=item.version.questionVersionId;
 await move(author,"ARCHIVE");
 assert.equal(item.question.authoringVersionId,draft);assert.equal(item.workflow.state,"DRAFT");assert.equal(item.question.currentVersionId,live);
 assert.equal(item.history.find(row=>row.version.questionVersionId===newest).workflow.state,"ARCHIVED");
 await move(author,"SUBMIT");await move(reviewer,"REQUEST_CHANGES","Clarify the retained second draft before publication.");
 await revise("Fourth safety draft may be archived to retain the previous changes request");
 await move(author,"ARCHIVE");
 assert.equal(item.question.authoringVersionId,draft);assert.equal(item.workflow.state,"CHANGES_REQUESTED");
 assert.equal(item.workflow.decisionReason,"Clarify the retained second draft before publication.");
 assert.equal(item.question.currentVersionId,live);
 }finally{await database.close();}
});
