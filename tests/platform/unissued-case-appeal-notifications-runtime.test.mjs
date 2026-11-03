import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {appealInterviewFixture,actualInterviewActions,recommendationForm} from "../helpers/appeal-interview-fixture.mjs";
import {seedConsoleFile,seedConsoleEvidence} from "../helpers/interview-console-file-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const load=(path)=>loadWorkerRegistrationTs("src/lib/"+path+".ts");
const {AuthAccessRepository}=load("auth/auth-access-repository");
const {InterviewSchedulingService}=load("interview/interview-scheduling-service");
const {InterviewRuntimeService}=load("interview/interview-runtime-service");
const {InterviewPlaybookService}=load("interview/interview-playbook-service");
const {CaseAppealService}=load("assurance/case-appeal-service");
const {resolveNotificationHref}=load("notifications/notification-domain");
const prefix="case.appeal.";

async function mfa(db,actor){
 const access=new AuthAccessRepository(db),time=new Date().toISOString();
 await access.authentication.insertSecurityEvent({eventId:"case-appeal-notice-admin-mfa",accountId:actor.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:time});
 await access.authentication.insertSecurityEvent({eventId:"case-appeal-notice-admin-login",accountId:actor.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:actor.sessionId,mfaEventId:"case-appeal-notice-admin-mfa"},occurredAt:time});
}
async function verify(db,type,appealId,version,participants,{excluded=[]}={}){
 const eventRef="case_appeal:"+appealId+":"+version;
 const jobs=(await db.query(`SELECT job_id,job_type,payload,enqueued_by_role FROM platform_outbox_jobs
  WHERE payload->>'eventType'=$1 AND payload->>'eventRef'=$2`,[type,eventRef])).rows;
 const portal=jobs.filter(x=>x.job_type==="notification.assurance.event");
 assert.equal(portal.length,1,"Exactly one authoritative notification intent for "+type);
 assert(jobs.some(x=>x.job_type==="email.assurance.event"),"Expected verified email recipient intent for "+type);
 assert.equal(jobs.every(x=>!JSON.stringify(x.payload).includes("evidence_record_")),true,"No private supporting file data in outbox payload");
 const projected=(await db.query("SELECT * FROM platform_project_assurance_event_notification($1)",[portal[0].job_id])).rows[0];
 assert(projected.created>=participants.length,"Required participant notifications must project for "+type);
 const notices=(await db.query("SELECT recipient_account_id,recipient_role,notification_type,target_key,target_reference,source_job_id FROM platform_notifications WHERE source_job_id=$1",[portal[0].job_id])).rows;
 assert(notices.every(n=>n.notification_type===type));
 for(const {accountId,role,target} of participants){
  const item=notices.find(x=>x.recipient_account_id===accountId&&x.recipient_role===role);
  assert(item,"No "+role+" notification for "+type);
  assert.equal(item.target_key,target,"Wrong case appeal deep-link target for "+role);
  const href=resolveNotificationHref({role,target:item.target_key,targetReference:item.target_reference});
  assert(href.startsWith("/"+role+"/") && !href.includes("undefined"),"Notification destination is real for "+role+" "+type);
  if(target==="case.appeal.record")assert.equal(href,"/"+role+"/case-appeals#"+appealId);
 }
 for(const accountId of excluded)assert(!notices.some(n=>n.recipient_account_id===accountId),"Original decision actor must never see independent case appeal notification");
 const repeated=(await db.query("SELECT * FROM platform_project_assurance_event_notification($1)",[portal[0].job_id])).rows[0];
 assert.equal(repeated.created,0,"Duplicate event projection must be idempotent");
 return {jobs,notices};
}
function worker(f){return {accountId:f.worker.accountId,role:"worker",target:"case.appeal.record"};}
function admin(f){return {accountId:f.admin.accountId,role:"admin",target:"case.appeal.record"};}
function assessor(f){return {accountId:f.assessor.accountId,role:"assessor",target:"interview.record"};}

test("Case appeal interview submitted/requested/reviewed notifications deliver only role-eligible sources and safe links",{timeout:180000},async()=>{
 const f=await appealInterviewFixture({caseAppeal:true});
 try{
  const db=f.database,appeal=f.appeal.appealId;
  await mfa(db,f.admin);
  await verify(db,prefix+"submitted",appeal,1,[worker(f),admin(f)],{excluded:[f.credentials.admin.accountId]});
  const requested=await f.followups.requestInterview(f.admin,{appealId:appeal,expectedVersion:1,
   reason:"A calibrated independent Assessor interview is needed to clarify this rejected-case appeal."});
  assert.equal(requested.assessorId,f.assessor.accountId);
  await verify(db,prefix+"interview.requested",appeal,2,[worker(f),assessor(f)],{excluded:[f.credentials.admin.accountId]});
  const service=new InterviewSchedulingService(db);
  let request=await service.getAssignedInterview({assessorAccountId:f.assessor.accountId,interviewRequestId:requested.interviewRequestId});
  request=await service.scheduleInterview({principal:f.assessor,tenantId:f.row.tenant_id,request,scheduledAt:new Date().toISOString()});
  const runtime=new InterviewRuntimeService(Promise.resolve(db)),session=await runtime.claim(f.assessor,request.interviewRequestId);
  await new InterviewPlaybookService(Promise.resolve(db)).ensure(f.assessor,request.interviewRequestId);
  await runtime.markWorkerReady(f.worker,request.interviewRequestId,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:false});
  await runtime.admit(f.assessor,request.interviewRequestId);
  await runtime.start(f.assessor,request.interviewRequestId);
  await actualInterviewActions(db,f.assessor).saveInterviewConsoleAction(recommendationForm(request.interviewRequestId,session.interviewSessionId));
  await runtime.end(f.assessor,request.interviewRequestId);
  await actualInterviewActions(db,f.assessor).submitInterviewConsoleAction(recommendationForm(request.interviewRequestId,session.interviewSessionId));
  await verify(db,prefix+"interview.submitted",appeal,3,[worker(f),admin(f)],{excluded:[f.credentials.admin.accountId]});
  const finalized=await new CaseAppealService(Promise.resolve(db)).review(f.admin,{appealId:appeal,version:3,
   status:"rejected",reason:"Independent completed Assessor review supports the original reasoned rejection."});
  assert.equal(finalized.status,"rejected");
  await verify(db,prefix+"reviewed",appeal,4,[worker(f),admin(f)],{excluded:[f.credentials.admin.accountId]});
  await assert.rejects(db.query("SELECT platform_enqueue_assurance_event_notifications($1,$2)",[prefix+"reviewed","case_appeal:"+appeal+":1"]),/source/i);
  const kept=(await db.query("SELECT case_status,credential_reference FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0];
  assert.equal(kept.case_status,"Rejected");assert.equal(kept.credential_reference,null);
  console.log("M21303_NOTICES_INTERVIEW: Worker/Admin/Assessor persisted role scoped, independently checked, deep links and outbox idempotence PASS");
 }finally{await f.cleanup();}
});

test("Case appeal evidence request and scanned Worker response notify only authorized Worker and independent Admin",{timeout:180000},async()=>{
 const f=await appealInterviewFixture({caseAppeal:true});
 try{
  const db=f.database,appeal=f.appeal.appealId;
  await mfa(db,f.admin);
  await verify(db,prefix+"submitted",appeal,1,[worker(f),admin(f)],{excluded:[f.credentials.admin.accountId]});
  const requested=await f.followups.request(f.admin,{appealId:appeal,expectedVersion:1,
   reason:"Please provide additional scanned qualifications for this independently reviewed rejected case."});
  await verify(db,prefix+"evidence.requested",appeal,2,[worker(f)],{excluded:[f.credentials.admin.accountId]});
  const file=await seedConsoleFile(db,f.worker.accountId,"case-appeal-notification-extra-scan-20261103");
  const record=await seedConsoleEvidence(db,f.worker.accountId,"qualification","case-appeal-notification-extra-owned-20261103",{file});
  const file2=await seedConsoleFile(db,f.worker.accountId,"case-appeal-notification-second-scan-20261103");
  const record2=await seedConsoleEvidence(db,f.worker.accountId,"qualification","case-appeal-notification-second-owned-20261103",{file:file2});
  await f.followups.respond(f.worker,{appealId:appeal,requestId:requested.requestId,expectedVersion:2,
   reason:"The additional scanned qualifications are now submitted for independent appeal consideration.",
   evidenceRecordIds:[record.recordId,record2.recordId]});
  const snapshots=(await db.query("SELECT file_id FROM assurance_case_appeal_evidence WHERE appeal_id=$1 AND request_id=$2",[appeal,requested.requestId])).rows;
  assert.equal(snapshots.length,2,"Both scanned files retained; only one logical response notice is permitted");
  await verify(db,prefix+"evidence.submitted",appeal,3,[worker(f),admin(f)],{excluded:[f.credentials.admin.accountId]});
  const outcomes=(await db.query("SELECT status,version FROM assurance_case_appeals WHERE appeal_id=$1",[appeal])).rows[0];
  assert.equal(outcomes.status,"under_review");assert.equal(Number(outcomes.version),3);
  await new CaseAppealService(Promise.resolve(db)).review(f.admin,{appealId:appeal,version:3,
   status:"accepted",reason:"The additional evidence justifies permitted reassessment within original policy scope."});
  await verify(db,prefix+"reviewed",appeal,4,[worker(f),admin(f)],{excluded:[f.credentials.admin.accountId]});
  const sql=readFileSync("database/migrations/0135_case_appeal_notifications.down.sql","utf8");
  const guard=sql.slice(sql.indexOf("DO $$ BEGIN"),sql.indexOf("END;$$;")+8);
  await assert.rejects(db.query(guard),/notification outbox histories must be retained/i);
  console.log("M21303_NOTICES_EVIDENCE: Admin evidence request -> Worker scanned response -> independent Admin -> Worker final, all same-source outbox, no foreign Admin PASS");
 }finally{await f.cleanup();}
});
