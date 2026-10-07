import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {adminVerificationSearchFixture} from "../helpers/admin-verification-search-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {CompanyVerificationReviewService}=loadWorkerRegistrationTs("src/lib/company/company-verification-review-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
test("Admin search filters live submitted queue before250 and rejects revoked sessions",{timeout:120000},async()=>{
 const fixture=await adminVerificationSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const sessionId="admin-search-native",now=new Date().toISOString(),principal={accountId:fixture.credentials.admin.accountId,sessionId,activeRole:"admin",accountStatus:"active",tenantMembership:null};
  await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:principal.accountId,activeRole:"admin",tokenHash:"admin-search-native-hash",csrfTokenHash:"admin-search-native-csrf",userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const service=new CompanyVerificationReviewService(db);
  assert.deepEqual((await service.listForReview(principal,"SEARCH ALPHA")).map(x=>x.caseId),[fixture.alpha.caseId],"Query must find submitted match beyond250 and exclude draft");
  assert.deepEqual((await service.listForReview(principal,fixture.beta.caseId)).map(x=>x.caseId),[fixture.beta.caseId]);
  assert.deepEqual((await service.listForReview(principal,"under review")).map(x=>x.caseId),[fixture.beta.caseId]);
  for(const q of ["' OR 1=1 --","%","z".repeat(10000)])assert.equal((await service.listForReview(principal,q)).length,0);
  assert.equal((await service.listForReview(principal," ")).length,250);
  await db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='Admin search test' WHERE session_id=$1",[sessionId,now]);
  await assert.rejects(service.listForReview(principal,"SEARCH ALPHA"),e=>e.name==="CompanyVerificationAccessDeniedError");
 }finally{await db.close();await fixture.cleanup();}
});
