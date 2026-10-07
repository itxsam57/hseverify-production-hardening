import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
test("An existing appointment cannot be changed without its required reschedule reason",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
  const first=await service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+86400000).toISOString()});
  const before=(await db.query("SELECT scheduled_at,schedule_event_id,reschedule_reason FROM interview_requests WHERE interview_request_id=$1",[first.interviewRequestId])).rows[0];
  await assert.rejects(()=>service.scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:first,scheduledAt:new Date(Date.now()+2*86400000).toISOString()}),/reschedule reason/i);
  assert.deepEqual((await db.query("SELECT scheduled_at,schedule_event_id,reschedule_reason FROM interview_requests WHERE interview_request_id=$1",[first.interviewRequestId])).rows[0],before);
 }finally{await db.close();await fixture.cleanup();}
});

const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {setWorkerRegistrationRuntimeEnvironment}=await import("../helpers/worker-registration-runtime-loader.mjs");
const {validateRuntimeEnvironment}=loadWorkerRegistrationTs("src/lib/config/environment.ts");
const {InterviewRuntimeService}=loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
test("Reasoned reschedule preserves immutable history, suppresses obsolete notices and sends current recipients once",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),oldFetch=globalThis.fetch;
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
  const input={principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha};
  const firstTime=new Date(Date.now()+86400000).toISOString(),nextTime=new Date(Date.now()+172800000).toISOString();
  const first=await service.scheduleInterview({...input,scheduledAt:firstTime});
  const snapshot=async()=>({request:(await db.query("SELECT scheduled_at,schedule_event_id,reschedule_reason FROM interview_requests WHERE interview_request_id=$1",[first.interviewRequestId])).rows,
   audit:(await db.query("SELECT audit_event_id,metadata FROM platform_audit_events WHERE action_key='interview.scheduled' ORDER BY audit_sequence")).rows,
   jobs:(await db.query("SELECT job_id,idempotency_key,payload FROM platform_outbox_jobs ORDER BY job_sequence")).rows});
  const before=await snapshot();
  for(const rescheduleReason of ["", "short", "x".repeat(1001)])await assert.rejects(()=>service.scheduleInterview({...input,scheduledAt:nextTime,rescheduleReason}),/reschedule reason/i);
  assert.deepEqual(await snapshot(),before);
  await service.scheduleInterview({...input,scheduledAt:firstTime});
  assert.deepEqual(await snapshot(),before,"Duplicate schedule must not create more notices or audit");
  const rescheduleReason="Worker requested another appointment";
  const updated=await service.scheduleInterview({...input,scheduledAt:nextTime,rescheduleReason:"  "+rescheduleReason+"  "});
  assert.equal(updated.rescheduleReason,rescheduleReason);assert.equal(updated.scheduledAt,nextTime);
  const after=await snapshot();assert.equal(after.audit.length,2);assert.deepEqual(after.audit[0],before.audit[0]);
  assert.equal(after.audit[1].metadata.previousScheduledAt,firstTime);assert.equal(after.audit[1].metadata.rescheduleReason,rescheduleReason);
  assert.equal(after.jobs.length-before.jobs.length,6);
  await service.scheduleInterview({...input,scheduledAt:nextTime,rescheduleReason});
  assert.deepEqual(await snapshot(),after);
  setWorkerRegistrationRuntimeEnvironment(validateRuntimeEnvironment({...fixture.environment,HSE_OTP_EMAIL_API_KEY:"controlled-reschedule-key",HSE_OTP_EMAIL_FROM:"notifications@example.test",HSE_PUBLIC_BASE_URL:"https://hse.example.test"}));
  let calls=0;globalThis.fetch=async(url,options)=>{assert.equal(String(url),"https://api.resend.com/emails");assert.doesNotMatch(options.body,/Worker requested another appointment/);return new Response(JSON.stringify({id:"controlled-reschedule-"+(++calls)}),{status:200});};
  const repository=new DatabaseOutboxRepository(Promise.resolve(db));
  for(let i=0;i<12;i++)assert.equal((await processNextOutboxJob({repository,database:db})).status,"succeeded");
  assert.equal(calls,3);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_notifications WHERE notification_type='interview.scheduled'")).rows[0].n,3);
  assert.deepEqual((await db.query("SELECT status,count(*)::int AS n FROM platform_email_deliveries WHERE delivery_type='interview.scheduled' GROUP BY status ORDER BY status")).rows,[{status:"sent",n:3},{status:"suppressed",n:3}]);
 }finally{globalThis.fetch=oldFetch;await db.close();await fixture.cleanup();}
});
test("Reschedule audit failure rolls back all effects and an already claimed interview cannot move",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),service=new InterviewSchedulingService(db);
  const input={principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha};
  const firstTime=new Date(Date.now()+86400000).toISOString(),nextTime=new Date(Date.now()+172800000).toISOString();
  await service.scheduleInterview({...input,scheduledAt:firstTime});
  const snapshot=async()=>({request:(await db.query("SELECT scheduled_at,schedule_event_id,reschedule_reason FROM interview_requests WHERE interview_request_id=$1",[input.request.interviewRequestId])).rows,jobs:(await db.query("SELECT job_id FROM platform_outbox_jobs ORDER BY job_sequence")).rows});
  const before=await snapshot();
  await db.exec("CREATE FUNCTION test_fail_reschedule_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='interview.scheduled' THEN RAISE EXCEPTION 'Injected schedule audit outage'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_reschedule_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_reschedule_audit()");
  await assert.rejects(()=>service.scheduleInterview({...input,scheduledAt:nextTime,rescheduleReason:"Worker requested another appointment"}),/Injected schedule audit outage/);
  assert.deepEqual(await snapshot(),before);
  await db.exec("DROP TRIGGER test_fail_reschedule_audit ON platform_audit_events; DROP FUNCTION test_fail_reschedule_audit()");
  await new InterviewRuntimeService(Promise.resolve(db)).claim(principal,input.request.interviewRequestId);
  await assert.rejects(()=>service.scheduleInterview({...input,scheduledAt:nextTime,rescheduleReason:"Worker requested another appointment"}),/waiting room|claimed|started/i);
  assert.deepEqual(await snapshot(),before);
 }finally{await db.close();await fixture.cleanup();}
});
