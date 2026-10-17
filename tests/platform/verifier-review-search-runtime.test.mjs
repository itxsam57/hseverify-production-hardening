import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { verifierReviewSearchFixture } from "../helpers/verifier-review-search-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
test("Verifier search filters authorized SQL records before the queue limit", {timeout:120000},async()=>{
 const fixture=await verifierReviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const service=new EvidenceReviewService(db),principal={activeRole:"verifier",accountStatus:"active",accountId:fixture.credentials.verifier.accountId,sessionId:"verifier-search-native",tenantMembership:null};
  await assert.rejects(service.listQueue(principal,"SEARCH-ALPHA"),error=>error.name==="EvidenceReviewAccessError");
  const now=new Date();
  await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'verifier',$3,$4,$5,$5,$6)",[
   principal.sessionId,principal.accountId,randomBytes(32).toString("hex"),randomBytes(32).toString("hex"),now.toISOString(),new Date(now.getTime()+3600000).toISOString()
  ]);
  const alpha=await service.listQueue(principal,"SEARCH-ALPHA");
  assert.equal(alpha.length,1,"Search must find the authorized match beyond the first250 queue rows");
  assert.equal(alpha[0].taskId,fixture.alpha);
  assert.deepEqual((await service.listQueue(principal,"SEARCH-BETA")).map(t=>t.taskId),[fixture.beta]);
  assert.equal((await service.listQueue(principal,"' OR 1=1 --")).length,0);
  assert.equal((await service.listQueue(principal,"%")).length,0);
  assert.equal((await service.listQueue(principal,"z".repeat(10000))).length,0);
  assert.equal((await service.listQueue(principal," ")).length,250);
  assert.equal(await service.findTask(principal,fixture.foreign),null);
  await db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='Native search test completed' WHERE session_id=$1",[principal.sessionId,new Date().toISOString()]);
  await assert.rejects(service.listQueue(principal,"SEARCH-ALPHA"),error=>error.name==="EvidenceReviewAccessError");
 }finally{await db.close();await fixture.cleanup();}
});
