
import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {DatabaseEmailDeliveryRepository}=loadWorkerRegistrationTs("src/lib/email-delivery/email-delivery-repository.ts");
const {bindTrustedAuditActor}=loadWorkerRegistrationTs("src/lib/audit/audit-domain.ts");
const {describeInterviewEmailDelivery}=loadWorkerRegistrationTs("src/lib/email-delivery/email-delivery-domain.ts");

test("Native email delivery type filtering precedes the limit and retains live recipient authorization",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const principal=await assessorSchedulingPrincipal(db,fixture.credentials.assessor);
  await new InterviewSchedulingService(db).scheduleInterview({principal,tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+86400000).toISOString()});
  const email=new DatabaseEmailDeliveryRepository(Promise.resolve(db)),outbox=new DatabaseOutboxRepository(Promise.resolve(db)),actor=bindTrustedAuditActor(principal);
  for(let i=0;i<21;i++)await db.transaction(async tx=>{
   const job=await outbox.enqueueInTransaction(tx,actor,{jobType:"email.delivery.foundation",businessKey:"native-email-visibility-"+i,payload:{fixtureRef:"email.foundation.success.visibility"+i}});
   await email.queueInTransaction(tx,job);
  });
  const newest=await email.listForPrincipal(principal,{limit:10});assert.equal(newest.length,10);assert.ok(newest.every(row=>row.deliveryType==="platform.foundation.email"));
  const filtered=await email.listForPrincipal(principal,{limit:1,deliveryType:"interview.scheduled"});
  assert.equal(filtered.length,1);assert.equal(filtered[0].recipientAccountId,principal.accountId);assert.equal(filtered[0].recipientRole,"assessor");assert.equal(filtered[0].status,"queued");
  assert.equal((await email.listForPrincipal(principal,{deliveryType:"interview.scheduled",beforeSequence:filtered[0].sequence})).length,0);
  await assert.rejects(()=>email.listForPrincipal(principal,{deliveryType:"unregistered"}),/Email delivery type filter is invalid/);
  await assert.rejects(()=>email.listForPrincipal({...principal,accountId:"search_foreign_assessor"},{deliveryType:"interview.scheduled"}),error=>error.name==="EmailDeliveryAccessDeniedError");
  await db.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1",[principal.accountId]);
  await assert.rejects(()=>email.listForPrincipal(principal,{deliveryType:"interview.scheduled"}),error=>error.name==="EmailDeliveryAccessDeniedError");
 }finally{await db.close();await fixture.cleanup();}
});
test("Consumer labels distinguish acceptance, confirmation, suppression, retry and unknown confirmation",()=>{
 for(const status of ["retry_wait","terminal_failed"])assert.match(describeInterviewEmailDelivery({status,lastResultCode:"provider_timeout"}).description,/Sending could not be confirmed/);
 const labels={queued:"Queued",processing:"Sending",retry_wait:"Retrying",sent:"Sent",delivered:"Delivered",suppressed:"Suppressed",terminal_failed:"Failed"};
 for(const [status,label] of Object.entries(labels))assert.equal(describeInterviewEmailDelivery({status,lastResultCode:null}).label,label);
 assert.match(describeInterviewEmailDelivery({status:"sent",lastResultCode:"provider_accepted"}).description,/Delivery has not been confirmed/);
 assert.equal(describeInterviewEmailDelivery({status:"terminal_failed",lastResultCode:"idempotency_window_expired"}).label,"Confirmation unavailable");
});
