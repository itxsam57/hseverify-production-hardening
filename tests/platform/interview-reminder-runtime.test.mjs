import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
const {InterviewRuntimeService}=loadTs("src/lib/interview/interview-runtime-service.ts");
const reminderJobs=db=>db.query("SELECT * FROM platform_outbox_jobs WHERE job_type IN ('notification.interview.reminder','email.interview.reminder') ORDER BY job_sequence");
const future=offset=>new Date(Date.now()+offset).toISOString();

test("Chosen reminder queues six durable recipient jobs at its exact UTC due time and deduplicates",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
  const reminderAt=future(1800000),scheduledAt=future(3600000),input={principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt,reminderAt};
  await service.scheduleInterview(input);
  const jobs=(await reminderJobs(db)).rows;
  assert.equal(jobs.length,6,"The actual scheduling producer must queue reminder work, not only retain a timestamp");
  assert.deepEqual(new Set(jobs.map(j=>j.job_type)),new Set(["notification.interview.reminder","email.interview.reminder"]));
  assert.deepEqual(new Set(jobs.map(j=>j.payload.recipientRole)),new Set(["worker","assessor","company"]));
  const stored=(await db.query("SELECT reminder_at,schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[input.request.interviewRequestId])).rows[0];
  assert.equal(new Date(stored.reminder_at).toISOString(),reminderAt);
  const event=(await db.query("SELECT metadata FROM platform_audit_events WHERE audit_event_id=$1",[stored.schedule_event_id])).rows[0];
  assert.equal(event.metadata.reminderAt,reminderAt);
  for(const job of jobs){
   assert.equal(new Date(job.next_attempt_at).toISOString(),reminderAt);
   assert.equal(job.status,"pending");assert.equal(job.attempt_count,0);
   assert.equal(job.payload.eventRef,stored.schedule_event_id);
   assert.deepEqual(Object.keys(job.payload).sort(),["eventRef","membershipRef","recipientRef","recipientRole"]);
  }
  await service.scheduleInterview(input);
  assert.equal((await reminderJobs(db)).rows.length,6);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_email_deliveries WHERE delivery_type='interview.reminder' AND status='queued' AND attempt_count=0 AND delivered_at IS NULL")).rows[0].n,3);
  await assert.rejects(db.query("SELECT * FROM platform_project_interview_reminder_notification($1)",[jobs.find(j=>j.job_type==="notification.interview.reminder").job_id]),/not due/i);
  console.log("ACTUAL_REMINDER_PRODUCER exact immutable due, six recipient jobs, queued-not-delivered, duplicate suppression and early projection denial");
 }finally{await db.close();await fixture.cleanup();}
});

test("Invalid reminder times and foreign or revoked scheduling authority cannot create work",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db),scheduledAt=future(3600000);
  for(const reminderAt of [scheduledAt,future(7200000),future(-60000)]){
   await assert.rejects(service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt,reminderAt}),e=>e.name==="InterviewSchedulingInputError");
  }
  const valid={principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt,reminderAt:future(1800000)};
  await assert.rejects(service.scheduleInterview({...valid,tenantId:"foreign-reminder-tenant"}),e=>e.name==="InterviewAssignmentAccessError");
  await assert.rejects(service.scheduleInterview({...valid,request:fixture.requests.ForeignAlpha}),e=>e.name==="InterviewAssignmentAccessError");
  await db.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='Reminder authority probe' WHERE session_id=$1",[principal.sessionId]);
  await assert.rejects(service.scheduleInterview(valid),e=>e.name==="InterviewAssignmentAccessError");
  assert.equal((await reminderJobs(db)).rows.length,0);
  assert.equal((await db.query("SELECT scheduled_at,reminder_at FROM interview_requests WHERE interview_request_id=$1",[valid.request.interviewRequestId])).rows[0].scheduled_at,null);
 }finally{await db.close();await fixture.cleanup();}
});

test("Partial reminder enqueue rolls back its recipient set and repairs once from the committed source",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db),reminderAt=future(1800000);
  await db.exec("CREATE FUNCTION test_reminder_enqueue_outage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.job_type IN ('notification.interview.reminder','email.interview.reminder') AND NEW.payload->>'recipientRole'='company' THEN RAISE EXCEPTION 'Controlled reminder enqueue outage'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_reminder_enqueue_outage BEFORE INSERT ON platform_outbox_jobs FOR EACH ROW EXECUTE FUNCTION test_reminder_enqueue_outage();");
  await service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:future(3600000),reminderAt});
  const source=(await db.query("SELECT schedule_event_id,reminder_at FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0];
  assert.equal(new Date(source.reminder_at).toISOString(),reminderAt);assert.ok(source.schedule_event_id);
  assert.equal((await reminderJobs(db)).rows.length,0);
  await assert.rejects(db.transaction(async tx=>tx.exec(await readFile("database/migrations/0092_interview_reminders.down.sql","utf8"))),/Retained interview reminder history/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_audit_events WHERE action_key IN ('notification.interview.reminder.enqueue.deferred','email.interview.reminder.enqueue.deferred') AND target_reference=$1",[source.schedule_event_id])).rows[0].n,2);
  await db.exec("DROP TRIGGER test_reminder_enqueue_outage ON platform_outbox_jobs; DROP FUNCTION test_reminder_enqueue_outage();");
  for(const channel of ["notifications","emails"]){
   const sql="SELECT platform_enqueue_interview_reminder_"+channel+"($1) AS n";
   assert.equal((await db.query(sql,[source.schedule_event_id])).rows[0].n,3);
   assert.equal((await db.query(sql,[source.schedule_event_id])).rows[0].n,0);
  }
  assert.equal((await reminderJobs(db)).rows.length,6);
  const revised=await service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:future(7200000),reminderAt:"",rescheduleReason:"Worker requested a later appointment"});
  assert.equal(revised.reminderAt,null);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_interview_reminder_recipients($1)",[source.schedule_event_id])).rows[0].n,0);
  assert.equal((await reminderJobs(db)).rows.length,6);
 }finally{await db.close();await fixture.cleanup();}
});

test("Reminder migration restores exact empty contracts and refuses retained due work",{timeout:120000},async()=>{
 const up=await readFile("database/migrations/0092_interview_reminders.up.sql","utf8"),down=await readFile("database/migrations/0092_interview_reminders.down.sql","utf8");
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 const empty=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://"});await applyMigrationsThrough(empty,"reminder-empty-rollback","0092_interview_reminders");
 try{
  const contract=(await empty.query("SELECT platform_interview_reminder_rollback_contract() AS contract")).rows[0].contract;
  await empty.transaction(tx=>tx.execute(down));
  for(const item of contract.constraints){
   assert.equal((await empty.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",[item.table,item.constraint])).rows[0].definition,item.definition);
  }
  for(const item of contract.functions){
   assert.equal((await empty.query("SELECT pg_get_functiondef($1::regprocedure) AS definition",[item.reference])).rows[0].definition,item.definition);
  }
  for(const item of contract.triggers){
   assert.equal((await empty.query("SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname=$1",[item.name])).rows[0].definition,item.definition);
  }
  await empty.transaction(tx=>tx.execute(up));
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:future(3600000),reminderAt:future(1800000)});
  await assert.rejects(db.transaction(tx=>tx.exec(down)),/Retained interview reminder history/);
  assert.equal((await reminderJobs(db)).rows.length,6);
 }finally{await empty.close();await db.close();await fixture.cleanup();}
});


test("Assessor confirmation activates a legacy stored reminder once without rewriting earlier audit history",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db),scheduledAt=future(3600000),reminderAt=future(1800000);
  await service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt});
  const before=(await db.query("SELECT schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0].schedule_event_id;
  // Pre-reminder records could retain this field without immutable reminder metadata.
  await db.query("UPDATE interview_requests SET reminder_at=$2 WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId,reminderAt]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_interview_reminder_recipients($1)",[before])).rows[0].n,0);
  const input={principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt,reminderAt,rescheduleReason:"Assessor confirmed the stored reminder choice"};
  await service.scheduleInterview(input);
  assert.equal((await reminderJobs(db)).rows.length,6,"An explicitly confirmed legacy reminder must become operative");
  const after=(await db.query("SELECT schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0].schedule_event_id;
  assert.notEqual(after,before);
  assert.equal((await db.query("SELECT metadata->>'reminderAt' AS reminder FROM platform_audit_events WHERE audit_event_id=$1",[before])).rows[0].reminder,null);
  assert.equal((await db.query("SELECT metadata->>'reminderAt' AS reminder FROM platform_audit_events WHERE audit_event_id=$1",[after])).rows[0].reminder,reminderAt);
  await service.scheduleInterview(input);assert.equal((await reminderJobs(db)).rows.length,6);
 }finally{await db.close();await fixture.cleanup();}
});

test("Reminder projections and email intents reject cross-type, source and recipient forgeries",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),reminderAt=future(3000);
  await new InterviewSchedulingService(db).scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:future(3600000),reminderAt});
  const jobs=(await db.query("SELECT * FROM platform_outbox_jobs ORDER BY job_sequence")).rows;
  for(const job of jobs.filter(j=>j.job_type==="notification.interview.scheduled"))await db.query("SELECT * FROM platform_project_interview_notification($1)",[job.job_id]);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,new Date(reminderAt).getTime()-Date.now()+40)));
  for(const job of jobs.filter(j=>j.job_type==="notification.interview.reminder"))await db.query("SELECT * FROM platform_project_interview_reminder_notification($1)",[job.job_id]);
  const notices=(await db.query("SELECT * FROM platform_notifications WHERE recipient_role='worker' AND notification_type IN ('interview.scheduled','interview.reminder')")).rows;
  const reminder=notices.find(n=>n.notification_type==="interview.reminder"),scheduled=notices.find(n=>n.notification_type==="interview.scheduled");
  assert.ok(reminder);assert.ok(scheduled);
  let index=0;
  const hash=label=>createHash("sha256").update("reminder-forgery-"+label+"-"+(++index)).digest("hex");
  const noticeColumns=["notification_id","notification_type","schema_version","source_job_id","projection_key","recipient_account_id","recipient_role","tenant_id","membership_id","title","body","metadata","target_key","target_reference"];
  const insertNotice=(base,changes)=>{
   const key=hash("notice"),candidate={...base,...changes,notification_id:"notification_"+key.slice(0,24),projection_key:key};
   return db.transaction(tx=>tx.query("INSERT INTO platform_notifications("+noticeColumns.join(",")+") VALUES("+noticeColumns.map((_,i)=>"$"+(i+1)).join(",")+")",noticeColumns.map(k=>k==="metadata"?JSON.stringify(candidate[k]):candidate[k])));
  };
  for(const [base,changes,message] of [
   [reminder,{source_job_id:scheduled.source_job_id},"Invalid interview notification source job"],
   [scheduled,{source_job_id:reminder.source_job_id},"Invalid interview notification source job"],
   [reminder,{recipient_account_id:"search_foreign_worker"},"Interview notification does not match its authorized source"],
   [reminder,{target_reference:fixture.requests.Beta.interviewRequestId},"Interview notification does not match its authorized source"],
   [reminder,{metadata:{eventRef:"missing-reminder-source"}},"Interview notification does not match its authorized source"],
   [reminder,{title:"Forged reminder"},"Interview notification does not match its authorized source"],
   [reminder,{notification_type:"platform.foundation.ready"},"notification must originate from a registered notification outbox job"]
  ])await assert.rejects(insertNotice(base,changes),e=>e.code==="23514" && e.message===message);
  const deliveries=(await db.query("SELECT * FROM platform_email_deliveries WHERE recipient_role='worker' AND delivery_type IN ('interview.scheduled','interview.reminder')")).rows;
  const reminderEmail=deliveries.find(d=>d.delivery_type==="interview.reminder"),scheduledEmail=deliveries.find(d=>d.delivery_type==="interview.scheduled");
  assert.ok(reminderEmail);assert.ok(scheduledEmail);
  const emailColumns=["delivery_id","delivery_type","schema_version","source_job_id","delivery_key","recipient_account_id","recipient_role","tenant_id","membership_id","recipient_address_hash"];
  const insertEmail=(base,changes)=>{
   const key=hash("email"),candidate={...base,...changes,delivery_id:"email_delivery_"+key.slice(0,24),delivery_key:key};
   return db.transaction(tx=>tx.query("INSERT INTO platform_email_deliveries("+emailColumns.join(",")+") VALUES("+emailColumns.map((_,i)=>"$"+(i+1)).join(",")+")",emailColumns.map(k=>candidate[k])));
  };
  for(const [base,changes,message] of [
   [reminderEmail,{source_job_id:scheduledEmail.source_job_id},"Invalid interview email source job"],
   [scheduledEmail,{source_job_id:reminderEmail.source_job_id},"Invalid interview email source job"],
   [reminderEmail,{recipient_account_id:"search_foreign_worker"},"Interview email does not match its authorized source"],
   [reminderEmail,{recipient_address_hash:hash("foreign-address")},"Interview email does not match its authorized source"]
  ])await assert.rejects(insertEmail(base,changes),e=>e.code==="23514" && e.message===message);
  const worker=jobs.find(j=>j.job_type==="notification.interview.reminder" && j.payload.recipientRole==="worker");
  for(const [changes,suppressed] of [
   [{payload:{...worker.payload,eventRef:"missing-reminder-source"}},true],
   [{payload:{...worker.payload,recipientRef:fixture.credentials.admin.accountId}},true],
   [{enqueued_by_account_id:"search_foreign_assessor"},false],
   [{payload:{...worker.payload,href:"https://attacker.invalid"}},false]
  ]){
   const key=hash("job"),job={...worker,...changes,job_id:"job_reminder_forged_"+key.slice(0,24),idempotency_key:key};
   await db.query("INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role,next_attempt_at) VALUES($1,$2,1,$3,$4::jsonb,$5,'assessor',$6)",[job.job_id,job.job_type,key,JSON.stringify(job.payload),job.enqueued_by_account_id,reminderAt]);
   const project=()=>db.transaction(tx=>tx.query("SELECT * FROM platform_project_interview_reminder_notification($1)",[job.job_id]));
   if(suppressed)assert.deepEqual((await project()).rows,[{created:false,suppressed:true}]);
   else await assert.rejects(project(),e=>e.code==="23514" && /Invalid interview notification source/.test(e.message));
  }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_notifications WHERE notification_type='interview.reminder'")).rows[0].n,3);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_email_deliveries WHERE delivery_type='interview.reminder'")).rows[0].n,3);
  console.log("ACTUAL_REMINDER_FORGERY_BOUNDARIES cross-type jobs, foreign recipient, target, metadata, title, address, actor and missing source denied or suppressed; no extra projection or email intent");
 }finally{await db.close();await fixture.cleanup();}
});

test("Actual technical hold and replacement suppress the original appointment reminders",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
  const first=await service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:future(3600000),reminderAt:future(1800000)});
  const source=(await db.query("SELECT schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[first.interviewRequestId])).rows[0].schedule_event_id;
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_interview_reminder_recipients($1)",[source])).rows[0].n,3);
  const runtime=new InterviewRuntimeService(Promise.resolve(db));
  assert.equal((await runtime.technicalIssue(principal,first.interviewRequestId,"Connection could not be restored.")).status,"TECHNICAL_HOLD");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_interview_reminder_recipients($1)",[source])).rows[0].n,0);
  const replacement=await service.requestReplacementInterview({principal,interviewRequestId:first.interviewRequestId,reason:"The documented interruption requires a replacement appointment."});
  assert.notEqual(replacement.interviewRequestId,first.interviewRequestId);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_interview_reminder_recipients($1)",[source])).rows[0].n,0);
  assert.equal((await reminderJobs(db)).rows.length,6,"Existing due work remains durable for safe suppression");
 }finally{await db.close();await fixture.cleanup();}
});
