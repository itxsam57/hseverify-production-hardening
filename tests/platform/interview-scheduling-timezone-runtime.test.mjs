import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
test("UTC interview and reminder inputs retain their instant under a different database timezone",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  await db.exec("SET TIME ZONE 'America/New_York'");
  const selected=new Date(Date.now()+86400000).toISOString().slice(0,16),expected=selected+":00.000Z";
  await new InterviewSchedulingService(db).scheduleInterview({tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:selected,reminderAt:selected});
  const stored=(await db.query("SELECT scheduled_at,reminder_at,timezone FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0];
  const actual=new Date(stored.scheduled_at).toISOString();console.log("ACTUAL_DATABASE_TIMEZONE_PROBE",JSON.stringify({expected,actual,recordTimezone:stored.timezone}));
  assert.equal(actual,expected,"Declared UTC interview must not shift under the database session timezone");
  assert.equal(new Date(stored.reminder_at).toISOString(),expected);
 }finally{await db.close();await fixture.cleanup();}
});
const {normalizeInterviewScheduleTimestamp}=loadTs("src/lib/interview/interview-scheduling-domain.ts");
test("Calendar normalization rejects rolled dates and preserves explicit offsets",()=>{
 assert.equal(normalizeInterviewScheduleTimestamp("2026-10-08T11:00:00+05:00"),"2026-10-08T06:00:00.000Z");
 assert.equal(normalizeInterviewScheduleTimestamp("2028-02-29T11:00"),"2028-02-29T11:00:00.000Z");
 for(const value of ["tomorrow","2026-02-30T11:00","2026-10-08T25:10","2026-10-08T10:60","2026-10-08T10:10:00+99:00"]){
  assert.throws(()=>normalizeInterviewScheduleTimestamp(value),e=>e.name==="InterviewSchedulingInputError");
 }
});
