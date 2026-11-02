import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
test("Scheduling a persisted assigned interview queues its required notifications",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const service=new InterviewSchedulingService(db),request=fixture.requests.Alpha;
  const count=async()=>Number((await db.query("SELECT COUNT(*) AS total FROM platform_outbox_jobs WHERE job_type LIKE 'notification.%'")).rows[0].total);
  const before=await count(),scheduledAt=new Date(Date.now()+3600000).toISOString();
  await service.scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request,scheduledAt});
  const persisted=(await db.query("SELECT scheduled_at FROM interview_requests WHERE interview_request_id=$1",[request.interviewRequestId])).rows[0];
  assert.equal(new Date(persisted.scheduled_at).toISOString(),scheduledAt);
  const after=await count();assert.equal(after-before,3);console.log("ACTUAL_NATIVE_SCHEDULE_PERSISTED_NOTIFICATION_QUEUE",JSON.stringify({before,after}));
  assert.ok(after>before,"Scheduling succeeded but created no durable notification work for Worker/Company recipients");
 }finally{await db.close();await fixture.cleanup();}
});

const {loadWorkerRegistrationTs}=await import("../helpers/worker-registration-runtime-loader.mjs");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {reconcileInterviewScheduledNotifications}=loadWorkerRegistrationTs("src/lib/notifications/interview-notification-projector.ts");
test("Actual notification worker projects authorized recipients; partial enqueue failure repairs once and obsolete revisions suppress",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
  const schedule=async(request,scheduledAt,rescheduleReason)=>service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request,scheduledAt,rescheduleReason});
  const jobs=async()=> (await db.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.interview.scheduled' ORDER BY job_sequence")).rows;
  const notices=async()=> (await db.query("SELECT * FROM platform_notifications WHERE notification_type='interview.scheduled' ORDER BY notification_sequence")).rows;
  const instant=new Date(Date.now()+3600000).toISOString();await schedule(fixture.requests.Alpha,instant);
  const alphaJobs=await jobs();assert.equal(alphaJobs.length,3);
  assert.deepEqual(new Set(alphaJobs.map(j=>j.payload.recipientRole)),new Set(["worker","assessor","company"]));
  for(const job of alphaJobs){
   assert.equal(job.enqueued_by_account_id,principal.accountId);assert.equal(job.enqueued_by_role,"assessor");
   assert.equal(job.tenant_id,null);assert.equal(job.membership_id,null);
   assert.deepEqual(Object.keys(job.payload).sort(),["eventRef","membershipRef","recipientRef","recipientRole"]);
  }
  const repository=new DatabaseOutboxRepository(Promise.resolve(db));
  for(let i=0;i<3;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  const projected=await notices();assert.equal(projected.length,3);
  assert.deepEqual(new Set(projected.map(n=>n.recipient_account_id)),new Set([principal.accountId,fixture.credentials.worker.accountId,fixture.credentials.company.accountId]));
  for(const notice of projected){
   assert.equal(notice.read_at,null);
   assert.equal(notice.target_key,notice.recipient_role==="company"?"company.assurance.case":"interview.record");
   assert.deepEqual((await db.query("SELECT * FROM platform_project_interview_notification($1)",[notice.source_job_id])).rows,[{created:false,suppressed:false}]);
  }
  // Real enqueue failure after earlier recipients inserted must roll the whole set back.
  await db.exec(`CREATE FUNCTION test_fail_company_interview_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF NEW.job_type='notification.interview.scheduled' AND NEW.payload->>'recipientRole'='company'
    THEN RAISE EXCEPTION 'Injected recipient enqueue outage';END IF;RETURN NEW;END;$$;
   CREATE TRIGGER test_fail_company_interview_enqueue BEFORE INSERT ON platform_outbox_jobs
   FOR EACH ROW EXECUTE FUNCTION test_fail_company_interview_enqueue();`);
  await schedule(fixture.requests.Beta,instant);
  assert.equal((await jobs()).length,3);
  const beta=(await db.query("SELECT scheduled_at,schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Beta.interviewRequestId])).rows[0];
  assert.equal(new Date(beta.scheduled_at).toISOString(),instant);assert.ok(beta.schedule_event_id);
  assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_audit_events WHERE action_key='notification.interview.intent.recorded' AND target_reference=$1",[beta.schedule_event_id])).rows[0].total),0);
  assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_audit_events WHERE action_key='notification.interview.enqueue.deferred' AND target_reference=$1",[beta.schedule_event_id])).rows[0].total),1);
  await db.exec("DROP TRIGGER test_fail_company_interview_enqueue ON platform_outbox_jobs;DROP FUNCTION test_fail_company_interview_enqueue()");
  assert.equal((await reconcileInterviewScheduledNotifications(db)).examined,0,"Recent deferral must respect retry cadence");
  await new Promise(resolve=>setTimeout(resolve,31000));
  assert.deepEqual(await reconcileInterviewScheduledNotifications(db),{examined:1,deferred:0});
  assert.equal((await jobs()).length,6);assert.equal((await reconcileInterviewScheduledNotifications(db)).examined,0);
  const oldBetaJobs=(await jobs()).slice(3);
  await schedule(fixture.requests.Beta,new Date(Date.parse(instant)+60000).toISOString(),"Worker requested a later appointment");
  assert.equal((await jobs()).length,9);
  for(const job of oldBetaJobs){
   assert.deepEqual((await db.query("SELECT * FROM platform_project_interview_notification($1)",[job.job_id])).rows,[{created:false,suppressed:true}]);
  }
  assert.equal((await notices()).length,3);
  // Same stale submitted request still resolves fresh assignment state; forged scope cannot update.
  await assert.rejects(service.scheduleInterview({principal,tenantId:"foreign-tenant-scheduling-probe",request:fixture.requests.Alpha,scheduledAt:instant}),e=>e.name==="InterviewAssignmentAccessError");
  await assert.rejects(schedule(fixture.requests.ForeignAlpha,instant),e=>e.name==="InterviewAssignmentAccessError");
  await db.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='Scheduling test' WHERE session_id=$1",[principal.sessionId]);
  await assert.rejects(schedule(fixture.requests.Alpha,instant),e=>e.name==="InterviewAssignmentAccessError");
  console.log("ACTUAL_INTERVIEW_NOTIFICATION_WORKER authorized3, immutable source, partial enqueue rollback, durable schedule retained, bounded repair once, stale revision suppression, foreign assignment/tenant and revoked-session denied");
 }finally{await db.close();await fixture.cleanup();}
});

test("Notification migration restores original constraints when empty and refuses source-only retained history",{timeout:120000},async()=>{
 const {readFile}=await import("node:fs/promises");
 const down=await readFile("database/migrations/0088_interview_scheduling_notifications.down.sql","utf8");
 const up=await readFile("database/migrations/0088_interview_scheduling_notifications.up.sql","utf8");
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 const empty=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:"memory://"});await applyMigrationsThrough(empty,"interview-empty-rollback","0090_interview_worker_availability");
 try{
  const definitions=(await empty.query("SELECT platform_interview_notification_rollback_constraints() AS definitions")).rows[0].definitions;
  for(const definition of definitions)assert.doesNotMatch(definition.definition,/interview\.scheduled|interview\.record|company\.assurance\.case/);
  const emailDown=await readFile("database/migrations/0089_interview_scheduling_email.down.sql","utf8");
  const emailUp=await readFile("database/migrations/0089_interview_scheduling_email.up.sql","utf8");
  const availabilityDown=await readFile("database/migrations/0090_interview_worker_availability.down.sql","utf8"),availabilityUp=await readFile("database/migrations/0090_interview_worker_availability.up.sql","utf8");
  await empty.transaction(tx=>tx.execute(availabilityDown));
  await empty.transaction(tx=>tx.execute(emailDown));
  await empty.transaction(tx=>tx.execute(down));
  for(const definition of definitions){
   const current=(await empty.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",[definition.table,definition.constraint])).rows[0].definition;
   assert.equal(current,definition.definition);
  }
  assert.equal(Number((await empty.query("SELECT count(*) AS total FROM interview_requests")).rows[0].total),0);
  await empty.transaction(tx=>tx.execute(up));
  await empty.transaction(tx=>tx.execute(emailUp));
  await empty.transaction(tx=>tx.execute(availabilityUp));
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor);
  await new InterviewSchedulingService(db).scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()-5*3600000).toISOString()});
  assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_outbox_jobs WHERE job_type='notification.interview.scheduled'")).rows[0].total),0,"Beyond the existing four-hour recovery window creates no late notice");
  assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_audit_events WHERE action_key='notification.interview.intent.recorded' AND (metadata->>'suppressed')::boolean")).rows[0].total),1);
  await assert.rejects(db.transaction(tx=>tx.exec(down)),/Retained interview notification history/);
  assert.ok((await db.query("SELECT schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0].schedule_event_id);
  await new Promise(resolve=>setTimeout(resolve,1200));
  await db.query("UPDATE auth_sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE session_id=$1",[principal.sessionId]);
  await assert.rejects(new InterviewSchedulingService(db).scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Beta,scheduledAt:new Date(Date.now()+3600000).toISOString()}),e=>e.name==="InterviewAssignmentAccessError");
  console.log("ACTUAL_INTERVIEW_NOTIFICATION_ROLLBACK empty restores four original constraints/retains requests; source-only history refuses rollback; late notices suppressed; expired persisted session denied");
 }finally{await empty.close();await db.close();await fixture.cleanup();}
});

test("Scheduling projection rejects forged content and current recipient access loss",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor);
  await new InterviewSchedulingService(db).scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  const jobs=(await db.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.interview.scheduled' ORDER BY job_sequence")).rows;
  for(const job of jobs)await db.query("SELECT * FROM platform_project_interview_notification($1)",[job.job_id]);
  const notices=(await db.query("SELECT * FROM platform_notifications WHERE notification_type='interview.scheduled'")).rows;
  const worker=notices.find(n=>n.recipient_role==='worker');
  const columns=['notification_id','notification_type','schema_version','source_job_id','projection_key','recipient_account_id','recipient_role','tenant_id','membership_id','title','body','metadata','target_key','target_reference'];
  let forgeryIndex=0;
  for(const changes of [
   {recipient_account_id:'search_foreign_worker'},
   {target_reference:fixture.requests.Beta.interviewRequestId},
   {title:'Forged title'},
   {metadata:{eventRef:'forged-event'}},
   {notification_type:'platform.foundation.ready'},
   {source_job_id:'missing-source-job'}
  ]){
   const candidate={...worker,...changes,notification_id:'notification_'+createHash('sha256').update('forged-notification-'+(++forgeryIndex)).digest('hex').slice(0,24),projection_key:createHash('sha256').update('forged-projection-'+forgeryIndex).digest('hex')};
   const expected=changes.notification_type?'notification must originate from a registered notification outbox job':changes.source_job_id?'Invalid interview notification source job':'Interview notification does not match its authorized source';
   await assert.rejects(db.transaction(tx=>tx.query('INSERT INTO platform_notifications('+columns.join(',')+') VALUES('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',columns.map(k=>k==='metadata'?JSON.stringify(candidate[k]):candidate[k]))),e=>e.code==='23514' && e.message===expected);
   assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_notifications WHERE notification_type='interview.scheduled'")).rows[0].total),3);
  }
  const {canOpenInterviewNotification}=loadWorkerRegistrationTs("src/lib/notifications/interview-notification-access.ts");
  const record=n=>({notificationType:n.notification_type,target:n.target_key,targetReference:n.target_reference});
  const companyPrincipal={accountId:fixture.credentials.company.accountId,activeRole:'company',tenantMembership:fixture.credentials.company};
  const companyNotice=notices.find(n=>n.recipient_role==='company'),assessorNotice=notices.find(n=>n.recipient_role==='assessor');
  assert.equal(await canOpenInterviewNotification(db,companyPrincipal,record(companyNotice)),true);
  assert.equal(await canOpenInterviewNotification(db,principal,record(assessorNotice)),true);
  await db.query("INSERT INTO auth_tenant_permission_overrides(membership_id,membership_role,permission_key,effect,reason) SELECT membership_id,membership_role,'company.orders.read','deny','Native permission revocation probe' FROM auth_tenant_memberships WHERE membership_id=$1",[fixture.credentials.company.membershipId]);
  assert.equal(await canOpenInterviewNotification(db,companyPrincipal,record(companyNotice)),false);
  await db.query("UPDATE interview_requests SET assessor_account_id='search_foreign_assessor' WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId]);
  assert.equal(await canOpenInterviewNotification(db,principal,record(assessorNotice)),false);
  assert.equal((await db.query("SELECT * FROM platform_interview_notification_recipients($1)",[jobs[0].payload.eventRef])).rows.length,0);
  assert.equal(notices.length,3);assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_notifications WHERE notification_type='interview.scheduled'")).rows[0].total),3);
  console.log("ACTUAL_NOTIFICATION_FORGERY_REJECTED recipient, target, title, metadata, cross-type, missing source; current company permission and assessor assignment loss denied");
 }finally{await db.close();await fixture.cleanup();}
});

test("Scheduling rejects a session expiring while the request lock is acquired",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),trace=[];
  await db.query("UPDATE auth_sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",[principal.sessionId]);
  // Real native SQL and elapsed DB time with a controlled wait at the request-lock boundary.
  // This proves validation order, not PostgreSQL multi-connection contention.
  const observed={transaction:fn=>db.transaction(tx=>fn({query:async(sql,params)=>{
   const result=await tx.query(sql,params);
   if(/FROM interview_requests/.test(sql)&&/FOR UPDATE/.test(sql)){trace.push('request-lock');await new Promise(resolve=>setTimeout(resolve,2300));}
   if(/clock_timestamp/.test(sql))trace.push('fresh-clock');
   return result;
  }}))};
  let rejected=false;try{await new InterviewSchedulingService(observed).scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});}
  catch(error){assert.equal(error.name,"InterviewAssignmentAccessError");rejected=true;}
  assert.ok(trace.lastIndexOf('fresh-clock')>trace.indexOf('request-lock'),"Final expiry check must follow the request lock");
  assert.equal(rejected,true);
  assert.equal((await db.query("SELECT schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0].schedule_event_id,null);
  console.log("ACTUAL_NATIVE_REQUEST_LOCK_BOUNDARY expired session denied after controlled elapsed DB time; no multi-connection contention claim");
 }finally{await db.close();await fixture.cleanup();}
});

test("Scheduling projection outage retries safely and rejects forged source jobs",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
  await service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+3600000).toISOString()});
  const originalJobs=(await db.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.interview.scheduled' ORDER BY job_sequence")).rows;
  await db.exec("CREATE FUNCTION test_interview_projection_outage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Controlled projection outage'; END; $$; CREATE TRIGGER test_interview_projection_outage BEFORE INSERT ON platform_notifications FOR EACH ROW EXECUTE FUNCTION test_interview_projection_outage()");
  const repository=new DatabaseOutboxRepository(Promise.resolve(db));
  const failed=await processNextOutboxJob({repository,database:db});assert.equal(failed.status,'retry_wait');assert.equal(failed.attemptCount,1);
  assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_notifications WHERE notification_type='interview.scheduled'")).rows[0].total),0);
  assert.ok((await db.query("SELECT schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0].schedule_event_id);
  await db.exec("DROP TRIGGER test_interview_projection_outage ON platform_notifications;DROP FUNCTION test_interview_projection_outage()");
  await db.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE job_id=$1",[failed.jobId]);
  const retried=await processNextOutboxJob({repository,database:db});assert.equal(retried.jobId,failed.jobId);assert.equal(retried.status,'succeeded');assert.equal(retried.attemptCount,2);
  assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_notifications WHERE source_job_id=$1",[failed.jobId])).rows[0].total),1);
  const worker=originalJobs.find(j=>j.payload.recipientRole==='worker');let index=0;
  for(const changes of [
   {enqueued_by_account_id:'search_foreign_assessor'},
   {payload:{...worker.payload,href:'https://attacker.invalid'}},
   {schema_version:2}
  ]){
   const job={...worker,...changes,job_id:'job_forged_interview_'+(++index),idempotency_key:createHash('sha256').update('forged-interview-key-'+index).digest('hex')};
   const insert=()=>db.query("INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)",[job.job_id,job.job_type,job.schema_version,job.idempotency_key,JSON.stringify(job.payload),job.enqueued_by_account_id,job.enqueued_by_role]);
   if(job.schema_version!==1){await assert.rejects(insert(),e=>e.code==='23514'&&e.constraint==='platform_outbox_jobs_schema_version_check');continue;}
   await insert();
   await assert.rejects(db.transaction(tx=>tx.query("SELECT * FROM platform_project_interview_notification($1)",[job.job_id])),e=>e.code==='23514'&&/Invalid interview notification source/.test(e.message));
  }
  const missingSource={...worker.payload,eventRef:'nonexistent-interview-source'};
  await db.query("INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role) VALUES('job_missing_interview_source','notification.interview.scheduled',1,$3,$1::jsonb,$2,'assessor')",[JSON.stringify(missingSource),principal.accountId,createHash('sha256').update('missing-interview-source').digest('hex')]);
  assert.deepEqual((await db.query("SELECT * FROM platform_project_interview_notification('job_missing_interview_source')")).rows,[{created:false,suppressed:true}]);
  await db.query("UPDATE interview_requests SET status='CANCELLED' WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId]);
  for(const job of originalJobs.filter(j=>j.job_id!==failed.jobId))assert.deepEqual((await db.query("SELECT * FROM platform_project_interview_notification($1)",[job.job_id])).rows,[{created:false,suppressed:true}]);
  assert.equal(Number((await db.query("SELECT count(*) AS total FROM platform_notifications WHERE notification_type='interview.scheduled'")).rows[0].total),1);
  console.log("ACTUAL_SCHEDULING_PROJECTION_RETRY source preserved, failed insert rolled back, retry once; foreign actor/extra payload/schema rejected; missing source and cancelled current request suppressed");
 }finally{await db.close();await fixture.cleanup();}
});
