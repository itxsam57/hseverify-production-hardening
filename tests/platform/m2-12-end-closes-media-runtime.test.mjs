import assert from "node:assert/strict";
import test from "node:test";
import {policyInterview} from "../helpers/interview-policy-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {authorizeInterviewMedia,publishInterviewMediaSignal,listInterviewMediaSignals}=loadWorkerRegistrationTs("src/lib/interview/interview-media-service.ts");
const signal={kind:"leave",payload:{connectionId:"m21207_case_connection_12345678901234"}};
test("M2.12.07 ended runtime denies BOTH participants media polling and all new signaling before recommendation is submitted",{timeout:90000},async()=>{
 const x=await policyInterview({policy:{...((await import("../helpers/interview-policy-fixture.mjs")).configuredPolicy()),minimumActiveSeconds:0},start:true});
 try{
  const id=x.request.interviewRequestId,worker={accountId:x.fixture.credentials.worker.accountId,role:"worker"},assessor={accountId:x.principal.accountId,role:"assessor"};
  assert.equal((await authorizeInterviewMedia(x.database,worker,id)).role,"worker");
  assert.equal((await authorizeInterviewMedia(x.database,assessor,id)).role,"assessor");
  await publishInterviewMediaSignal(x.database,assessor,id,signal);
  assert.equal((await listInterviewMediaSignals(x.database,worker,id)).length,1);
  await x.save(x.scores());
  const ended=await x.runtime.end(x.principal,id);
  assert.equal(ended.status,"ENDED");
  assert.equal((await x.database.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[id])).rows[0].status,"ASSIGNED","Interview remains ASSIGNED between End and final Submit");
  for(const actor of [worker,assessor]){
   await assert.rejects(authorizeInterviewMedia(x.database,actor,id,{allowCompleted:true}),/ended|closed|complete/i,"An ENDED runtime must close GET immediately");
   await assert.rejects(listInterviewMediaSignals(x.database,actor,id,{allowCompleted:true}),/ended|closed|complete/i,"Ended interview must close media poll");
   await assert.rejects(publishInterviewMediaSignal(x.database,actor,id,signal),/ended|closed|complete/i,"No new signal may be injected after End");
  }
  const history=(await x.database.query("SELECT signal_kind FROM interview_media_signals WHERE interview_request_id=$1",[id])).rows;
  assert.deepEqual(history,[{signal_kind:"leave"}]);
  console.log("ACTUAL_M21207_NATIVE real End while request still ASSIGNED, both role media GET/POST denied, existing signal history retained unchanged.");
 }finally{await x.cleanup();}
});
