import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { verifierReviewSearchFixture } from "../helpers/verifier-review-search-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
test("Verifier search filters authorized SQL records before the queue limit", {timeout:120000},async()=>{
 const fixture=await verifierReviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const service=new EvidenceReviewService(db),principal={activeRole:"verifier",accountStatus:"active",accountId:fixture.credentials.verifier.accountId,sessionId:"verifier-search-native",tenantMembership:null};
  const alpha=await service.listQueue(principal,"SEARCH-ALPHA");
  assert.equal(alpha.length,1,"Search must find the authorized match beyond the first250 queue rows");
  assert.equal(alpha[0].taskId,fixture.alpha);
  assert.deepEqual((await service.listQueue(principal,"SEARCH-BETA")).map(t=>t.taskId),[fixture.beta]);
  assert.equal((await service.listQueue(principal,"' OR 1=1 --")).length,0);
  assert.equal((await service.listQueue(principal,"%")).length,0);
  assert.equal((await service.listQueue(principal,"z".repeat(10000))).length,0);
  assert.equal((await service.listQueue(principal," ")).length,250);
  assert.equal(await service.findTask(principal,fixture.foreign),null);
 }finally{await db.close();await fixture.cleanup();}
});
