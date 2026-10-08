import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
async function workerPrincipal(db,identity){
 const sessionId="availability-native-"+randomUUID(),now=new Date().toISOString();
 await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:identity.accountId,activeRole:"worker",tokenHash:createHash("sha256").update(sessionId).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+sessionId).digest("hex"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
 return {accountId:identity.accountId,sessionId,activeRole:"worker",accountStatus:"active",tenantMembership:null};
}
test("Worker-owned availability persists, reaches the Assessor and bounds actual scheduling",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
 const service=new InterviewSchedulingService(db),principal=await workerPrincipal(db,fixture.credentials.worker),assessor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),request=fixture.requests.Alpha;
 const availableFrom=new Date(Date.now()+86400000).toISOString(),availableUntil=new Date(Date.now()+172800000).toISOString();
 await service.setWorkerAvailability({principal,interviewRequestId:request.interviewRequestId,availableFrom,availableUntil});
 const owned=await service.getWorkerInterview({workerAccountId:principal.accountId,interviewRequestId:request.interviewRequestId});
 assert.deepEqual(owned.workerAvailability,{availableFrom,availableUntil});
 const assigned=await service.getAssignedInterview({assessorAccountId:assessor.accountId,interviewRequestId:request.interviewRequestId});
 assert.deepEqual(assigned.workerAvailability,owned.workerAvailability);
 await assert.rejects(()=>service.scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request,scheduledAt:new Date(Date.now()+3*86400000).toISOString()}),/availability/i);
 await assert.rejects(()=>service.scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request,scheduledAt:availableUntil}),/availability/i);
 assert.equal((await service.scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request,scheduledAt:availableFrom})).scheduledAt,availableFrom);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_audit_events WHERE action_key='interview.availability.updated'")).rows[0].n,1);
 }finally{await db.close();await fixture.cleanup();}
});

const {InterviewRuntimeService}=loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
test("Availability rejects invalid/foreign/revoked input, preserves appointments and rolls back required audit failure",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
 const service=new InterviewSchedulingService(db),principal=await workerPrincipal(db,fixture.credentials.worker),assessor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor);
 const input={principal,interviewRequestId:fixture.requests.Alpha.interviewRequestId,availableFrom:new Date(Date.now()+86400000).toISOString(),availableUntil:new Date(Date.now()+172800000).toISOString()};
 const snapshot=async()=>({requests:(await db.query("SELECT scheduled_at,candidate_available_from,candidate_available_until FROM interview_requests ORDER BY interview_request_id")).rows,audit:(await db.query("SELECT audit_event_id FROM platform_audit_events ORDER BY audit_sequence")).rows,jobs:(await db.query("SELECT job_id FROM platform_outbox_jobs ORDER BY job_sequence")).rows});
 const before=await snapshot();
 for(const overrides of [{availableFrom:"bad"},{availableUntil:input.availableFrom},{availableFrom:input.availableUntil,availableUntil:input.availableFrom},{availableFrom:"2026-02-30T10:00",availableUntil:input.availableUntil},{availableFrom:"2020-01-01T00:00Z",availableUntil:"2020-01-02T00:00Z"}])await assert.rejects(()=>service.setWorkerAvailability({...input,...overrides}));
 const foreign=await workerPrincipal(db,{accountId:"search_foreign_worker"});
 await assert.rejects(()=>service.setWorkerAvailability({...input,principal:foreign}),error=>error.name==="InterviewWorkerAccessError");
 await assert.rejects(()=>service.setWorkerAvailability({...input,principal:assessor}),error=>error.name==="InterviewWorkerAccessError");
 assert.deepEqual(await snapshot(),before);
 await service.setWorkerAvailability(input);const saved=await snapshot();await service.setWorkerAvailability(input);assert.deepEqual(await snapshot(),saved,"Duplicate save creates no new history or jobs");
 await service.scheduleInterview({principal:assessor,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:input.availableFrom});
 const scheduled=(await db.query("SELECT scheduled_at,schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[input.interviewRequestId])).rows[0];
 const changed={...input,availableFrom:new Date(Date.now()+3*86400000).toISOString(),availableUntil:new Date(Date.now()+4*86400000).toISOString()};
 await service.setWorkerAvailability(changed);
 assert.deepEqual((await db.query("SELECT scheduled_at,schedule_event_id FROM interview_requests WHERE interview_request_id=$1",[input.interviewRequestId])).rows[0],scheduled,"New availability must not move the existing appointment");
 const auditBefore=await snapshot();
 await db.exec("CREATE FUNCTION test_fail_availability_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='interview.availability.updated' THEN RAISE EXCEPTION 'Injected availability audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_availability_audit BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION test_fail_availability_audit()");
 await assert.rejects(()=>service.setWorkerAvailability(input),/Injected availability audit failure/);assert.deepEqual(await snapshot(),auditBefore);
 await db.exec("DROP TRIGGER test_fail_availability_audit ON platform_audit_events;DROP FUNCTION test_fail_availability_audit()");
 await new InterviewRuntimeService(Promise.resolve(db)).claim(assessor,input.interviewRequestId);
 const claimed=await snapshot();await assert.rejects(()=>service.setWorkerAvailability(input),/claimed/i);assert.deepEqual(await snapshot(),claimed);
 await db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='logout' WHERE session_id=$1",[principal.sessionId]);
 await assert.rejects(()=>service.setWorkerAvailability({...input,interviewRequestId:fixture.requests.Beta.interviewRequestId}),error=>error.name==="InterviewWorkerAccessError");assert.deepEqual(await snapshot(),claimed);
 }finally{await db.close();await fixture.cleanup();}
});
test("Availability session expiry after required audit rolls back the window and history",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
 const principal=await workerPrincipal(db,fixture.credentials.worker),input={principal,interviewRequestId:fixture.requests.Alpha.interviewRequestId,availableFrom:new Date(Date.now()+86400000).toISOString(),availableUntil:new Date(Date.now()+172800000).toISOString()};
 const before=(await db.query("SELECT audit_event_id FROM platform_audit_events ORDER BY audit_sequence")).rows;
 await db.query("UPDATE auth_sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",[principal.sessionId]);
 const wrapped={transaction:callback=>db.transaction(tx=>callback({query:async(sql,args)=>{
  const result=await tx.query(sql,args);if(sql.includes("INSERT INTO platform_audit_events"))await new Promise(resolve=>setTimeout(resolve,2200));return result;
 }}))};
 await assert.rejects(()=>new InterviewSchedulingService(wrapped).setWorkerAvailability(input),error=>error.name==="InterviewWorkerAccessError");
 assert.equal((await db.query("SELECT candidate_available_from FROM interview_requests WHERE interview_request_id=$1",[input.interviewRequestId])).rows[0].candidate_available_from,null);
 assert.deepEqual((await db.query("SELECT audit_event_id FROM platform_audit_events ORDER BY audit_sequence")).rows,before);
 }finally{await db.close();await fixture.cleanup();}
});
test("Empty availability rollback restores the exact audit constraint and retained history refuses rollback",async()=>{
 const {readFile}=await import("node:fs/promises");
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
 const down=await readFile("database/migrations/0090_interview_worker_availability.down.sql","utf8"),up=await readFile("database/migrations/0090_interview_worker_availability.up.sql","utf8");
 const original=(await db.query("SELECT platform_interview_availability_original_check() AS original")).rows[0].original;
 await db.transaction(tx=>tx.exec(down));assert.equal((await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='platform_audit_events'::regclass AND conname='platform_audit_events_action_key_check'")).rows[0].definition,original);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM interview_requests")).rows[0].n,3);
 await db.transaction(tx=>tx.exec(up));
 await assert.rejects(()=>db.query("UPDATE interview_requests SET candidate_available_from=clock_timestamp() WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId]),/interview_candidate_availability_window/);
 const principal=await workerPrincipal(db,fixture.credentials.worker);await new InterviewSchedulingService(db).setWorkerAvailability({principal,interviewRequestId:fixture.requests.Alpha.interviewRequestId,availableFrom:new Date(Date.now()+86400000).toISOString(),availableUntil:new Date(Date.now()+172800000).toISOString()});
 await assert.rejects(()=>db.transaction(tx=>tx.exec(down)),/Retained interview availability history prevents rollback/);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_audit_events WHERE action_key='interview.availability.updated'")).rows[0].n,1);
 }finally{await db.close();await fixture.cleanup();}
});

const {collectWorkerPrivacyData}=loadWorkerRegistrationTs("src/lib/privacy/worker-privacy-data.ts");
test("Owned privacy data includes provided interview availability without private staff context",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
 const principal=await workerPrincipal(db,fixture.credentials.worker),input={principal,interviewRequestId:fixture.requests.Alpha.interviewRequestId,availableFrom:new Date(Date.now()+86400000).toISOString(),availableUntil:new Date(Date.now()+172800000).toISOString()};
 await new InterviewSchedulingService(db).setWorkerAvailability(input);
 const data=await collectWorkerPrivacyData(db,principal.accountId,new Date().toISOString());
 assert.equal(data.interviewAvailability.length,1);
 assert.equal(data.interviewAvailability[0].interview_request_id,input.interviewRequestId);
 assert.equal(new Date(data.interviewAvailability[0].candidate_available_from).toISOString(),input.availableFrom);
 const foreign=await collectWorkerPrivacyData(db,"search_foreign_worker",new Date().toISOString());
 assert.deepEqual(foreign.interviewAvailability,[]);
 for(const key of ["reschedule_reason","assessor_account_id","schedule_event_id"])assert.equal(JSON.stringify(data.interviewAvailability).includes(key),false);
 }finally{await db.close();await fixture.cleanup();}
});
