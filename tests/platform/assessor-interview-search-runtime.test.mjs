import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assessorInterviewSearchFixture } from "../helpers/assessor-interview-search-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
test("Assessor search filters only assigned SQL records and retains account scope for console lookup", {timeout:120000}, async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const service=new InterviewSchedulingService(db),account=fixture.credentials.assessor.accountId;
  const own=fixture.requests.Alpha,foreign=fixture.requests.ForeignAlpha;
  assert.deepEqual((await service.getAssessorAssignments({assessorAccountId:account,query:own.interviewRequestId})).map(r=>r.interviewRequestId),[own.interviewRequestId]);
  assert.equal((await service.getAssessorAssignments({assessorAccountId:account,query:"' OR 1=1 --"})).length,0);
  assert.equal((await service.getAssessorAssignments({assessorAccountId:account,query:"%"})).length,0);
  assert.deepEqual((await service.getAssessorAssignments({assessorAccountId:account,query:own.caseId})).map(r=>r.interviewRequestId),[own.interviewRequestId]);
  assert.equal((await service.getAssessorAssignments({assessorAccountId:account,query:fixture.credentials.worker.accountId})).length,2);
  assert.equal((await service.getAssessorAssignments({assessorAccountId:account,query:"assigned"})).length,2);
  assert.equal((await service.getAssessorAssignments({assessorAccountId:account,query:"z".repeat(10000)})).length,0);
  assert.equal((await service.getAssessorAssignments({assessorAccountId:account,query:"  "})).length,2);
  await assert.rejects(()=>service.getAssignedInterview({assessorAccountId:account,interviewRequestId:foreign.interviewRequestId}),/not found/);
 } finally {await db.close();await fixture.cleanup();}
});
