import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const {AssuranceOrderService}=loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const {bindTenantPermissionPrincipal}=loadWorkerRegistrationTs("src/lib/authorization/tenant-scoped-resource-domain.ts");
async function companyPrincipal(db,identity){
 const sessionId="company-schedule-native-"+randomUUID(),now=new Date().toISOString();
 await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:identity.accountId,activeRole:"company",
  tokenHash:createHash("sha256").update(sessionId).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+sessionId).digest("hex"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
 return bindTenantPermissionPrincipal({accountId:identity.accountId,sessionId,activeRole:"company",accountStatus:"active",
  tenantMembership:{tenantId:identity.tenantId,membershipId:identity.membershipId,status:"active",tenantStatus:"active"}},"company.orders.read");
}
test("Actual Company appointment read is scoped to its order and reflects a reasoned reschedule without private metadata",async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const company=await companyPrincipal(db,fixture.credentials.company),principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor),scheduling=new InterviewSchedulingService(db),service=new AssuranceOrderService(db);
  const order=(await db.query("SELECT order_id FROM assurance_cases WHERE case_id=$1",[fixture.requests.Alpha.caseId])).rows[0].order_id;
  const otherOrder=(await db.query("SELECT order_id FROM assurance_cases WHERE case_id=$1",[fixture.requests.Beta.caseId])).rows[0].order_id;
  assert.deepEqual(await service.listInterviewSchedules(company,order),{});
  const firstTime=new Date(Date.now()+86400000).toISOString(),newTime=new Date(Date.now()+172800000).toISOString();
  const input={principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha};
  await scheduling.scheduleInterview({...input,scheduledAt:firstTime});
  assert.deepEqual(await service.listInterviewSchedules(company,order),{[input.request.caseId]:firstTime});
  await scheduling.scheduleInterview({...input,scheduledAt:newTime,rescheduleReason:"Worker requested another appointment"});
  assert.deepEqual(await service.listInterviewSchedules(company,order),{[input.request.caseId]:newTime});
  assert.deepEqual(await service.listInterviewSchedules(company,otherOrder),{});
  await assert.rejects(()=>service.listInterviewSchedules({...company,tenantMembership:{...company.tenantMembership,tenantId:"foreign-company-scope"}},order));
  await assert.rejects(()=>service.listInterviewSchedules({...company,authorizedTenantPermission:"company.settings.manage"},order));
  await db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='logout' WHERE session_id=$1",[company.sessionId]);
  await assert.rejects(()=>service.listInterviewSchedules(company,order));
  await db.query("UPDATE auth_sessions SET revoked_at=NULL,revocation_reason=NULL,expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",[company.sessionId]);
  const wrapped={transaction:callback=>db.transaction(tx=>callback({query:async(sql,args)=>{
    const result=await tx.query(sql,args);
    if(sql.includes("SELECT DISTINCT ON (requests.case_id)"))await new Promise(resolve=>setTimeout(resolve,2200));
    return result;
  }}))};
  await assert.rejects(()=>new AssuranceOrderService(wrapped).listInterviewSchedules(company,order),error=>error.name==="AssuranceOrderAccessError");
 }finally{await db.close();await fixture.cleanup();}
});
