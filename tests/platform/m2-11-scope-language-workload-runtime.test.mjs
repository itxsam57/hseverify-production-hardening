import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import test from "node:test";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewAssignmentService}=loadWorkerRegistrationTs("src/lib/interview/interview-assignment-service.ts");
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");

test("M2.11.01 pinned scope/language/jurisdiction/risk/availability/workload/calibration and exclusion lead to one eligible assignment",{timeout:120000},async()=>{
 const f=await assessorInterviewSearchFixture(),db=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
 try{
  const now=new Date().toISOString(),sessionId="match-admin-"+randomUUID();
  await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:f.credentials.admin.accountId,activeRole:"admin",tokenHash:createHash("sha256").update(sessionId).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+sessionId).digest("hex"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const admin={accountId:f.credentials.admin.accountId,sessionId,activeRole:"admin",accountStatus:"active",tenantMembership:null};
  const match=new InterviewAssignmentService(db);
  const request=await new InterviewSchedulingService(db).requestAdditionalInterview({tenantId:f.credentials.company.tenantId,caseId:f.requests.Alpha.caseId,workerAccountId:f.credentials.worker.accountId,requestedAt:now});
  await db.query("UPDATE interview_requests SET trade_scope='Electrical',qualification_scope='Level3',language='English',jurisdiction='GLOBAL',risk_level='HIGH' WHERE interview_request_id=$1",[request.interviewRequestId]);
  const profile={assessorAccountId:f.credentials.assessor.accountId,tradeScopes:["Electrical"],qualificationScopes:["Level3"],languages:["English"],jurisdictions:["GLOBAL"],riskLevels:["HIGH"],availability:{},maxActiveInterviews:3,status:"ACTIVE"};
  const candidate=async()=>{const r=await match.evaluate(request.interviewRequestId);return r.candidates.find(x=>x.assessorAccountId===profile.assessorAccountId)};
  await match.upsertProfile(admin,profile);
  const initial=await candidate();
  assert.ok(initial?.eligible,JSON.stringify(initial));
  assert.ok(initial.checks.calibration);assert.ok(initial.checks.workload);
  const negative=[
   ["tradeScope",{tradeScopes:["Welding"]}],
   ["qualificationScope",{qualificationScopes:["Level4"]}],
   ["language",{languages:["Urdu"]}],
   ["jurisdiction",{jurisdictions:["KSA"]}],
   ["risk",{riskLevels:["STANDARD"]}],
   ["availability",{availability:{unavailable:true}}],
   ["availability",{availability:{unavailableUntil:new Date(Date.now()+86400000).toISOString()}}],
   ["workload",{maxActiveInterviews:2}]
  ];
  for(const [name,change] of negative){
   await match.upsertProfile(admin,{...profile,...change});
   const row=await candidate();assert.ok(row);assert.equal(row.eligible,false,"Must reject mismatched "+name);assert.equal(row.checks[name],false,"Must expose reason "+name);
   assert.equal((await match.evaluate(request.interviewRequestId)).selectedAssessorAccountId,null);
  }
  await match.upsertProfile(admin,{...profile,status:"PAUSED"});
  assert.ok(!(await match.evaluate(request.interviewRequestId)).candidates.some(x=>x.assessorAccountId===profile.assessorAccountId),"Paused profile removed entirely");
  await match.upsertProfile(admin,profile);
  const calibration=(await db.query("SELECT framework_id,framework_version_id FROM staff_calibrations WHERE account_id=$1 AND role='assessor' ORDER BY calibration_sequence DESC LIMIT 1",[profile.assessorAccountId])).rows[0];assert.ok(calibration);
  const newCalibration=async(status,from,until)=>{
   await new StaffCalibrationService(Promise.resolve(db)).record(admin,{accountId:profile.assessorAccountId,role:"assessor",frameworkReference:"SEARCH-WORKER",frameworkVersionId:calibration.framework_version_id,status,validFrom:from,validUntil:until,note:"Test latest authoritative framework revision calibration."});
  };
  await newCalibration("FAILED",new Date(),new Date(Date.now()+86400000));
  let c=await candidate();assert.equal(c.eligible,false);assert.equal(c.checks.calibration,false);
  await newCalibration("CURRENT",new Date(),new Date(Date.now()+1100));
  await new Promise(resolve=>setTimeout(resolve,1250));
  c=await candidate();assert.equal(c.checks.calibration,false);
  await newCalibration("CURRENT",new Date(),new Date(Date.now()+86400000));
  c=await candidate();assert.equal(c.eligible,true);
  const result=await match.matchAndAssign(admin,request.interviewRequestId);
  assert.equal(result.selectedAssessorAccountId,profile.assessorAccountId);
  const actual=(await db.query("SELECT status,assessor_account_id FROM interview_requests WHERE interview_request_id=$1",[request.interviewRequestId])).rows[0];
  assert.deepEqual(actual,{status:"ASSIGNED",assessor_account_id:profile.assessorAccountId});
  const persisted=(await db.query("SELECT selected,eligibility_json,score,rationale FROM interview_assignment_decisions WHERE interview_request_id=$1",[request.interviewRequestId])).rows;
  assert.equal(persisted.filter(row=>row.selected).length,1);
  assert.ok(persisted.find(row=>row.selected).score>0);
  await assert.rejects(match.matchAndAssign(admin,request.interviewRequestId),/not awaiting assignment/i);
  console.log("ACTUAL_M21101_NATIVE checks eight matching denials, PAUSED, FAILED, time-expired CURRENT, renewed CURRENT, persisted eligible selection and retry denied");
 }finally{await db.close();await f.cleanup();}
});
