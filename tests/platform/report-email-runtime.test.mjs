import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomBytes} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createServer} from "node:http";
import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "../helpers/worker-registration-runtime-loader.mjs";
import {reportCompanyFixture,reportDenyExport} from "../helpers/report-company-fixture.mjs";
const {WorkerReportService}=loadWorkerRegistrationTs("src/lib/reports/worker-report-service.ts");
const {ReportDeliveryRepository}=loadWorkerRegistrationTs("src/lib/reports/report-delivery-repository.ts");
const {ReportDeliveryService}=loadWorkerRegistrationTs("src/lib/reports/report-delivery-service.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {processReportEmailJob}=loadWorkerRegistrationTs("src/lib/reports/report-email-handler.ts");
const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
function service(f){return new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(f.database)),f.storage);}
function request(f,id){return {reportId:id,reportType:"workforce-status",format:"csv",tenantId:f.credentials.company.tenantId,
 requestedBy:f.credentials.company.accountId,requestedAt:new Date().toISOString(),queueEmail:true};}
function worker(f){return processNextOutboxJob({database:f.database,repository:new DatabaseOutboxRepository(Promise.resolve(f.database))});}
async function mail(f,id){return (await f.database.query("SELECT * FROM report_email_deliveries WHERE report_id=$1",[id])).rows[0];}
async function provider(f,reply={code:200,body:{id:"report_provider_local_accepted"}}){
 const calls=[];
 const server=createServer(async (req,res)=>{
  let body="";for await(const chunk of req)body+=chunk;
  calls.push({path:req.url,headers:req.headers,body:JSON.parse(body)});
  res.writeHead(reply.code,{"Content-Type":"application/json"});res.end(JSON.stringify(reply.body));
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const origin="http://127.0.0.1:"+server.address().port,originalFetch=globalThis.fetch;
 setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development",publicBaseUrl:origin,
  registrationOtpProviders:{emailApiKey:"local-fixture-provider-key",emailFrom:"HSE Verify <fixture@example.test>"}});
 globalThis.fetch=(url,init)=>{assert.equal(url,"https://api.resend.com/emails");return originalFetch(origin+"/emails",init);};
 return {calls,origin,cleanup:async()=>{globalThis.fetch=originalFetch;setWorkerRegistrationRuntimeEnvironment({appEnvironment:"development"});await new Promise(resolve=>server.close(resolve));}};
}
test("Actual report generation enqueues its artifact-backed owner email and the registered transport confirms one local HTTP delivery",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();let local;
 try{
  const saved=await service(f).queue(request(f,"report_actual_email_owner"),f.principal);
  assert.equal((await f.database.query("SELECT * FROM report_email_deliveries")).rows.length,0,"No email may be queued before actual artifact storage");
  const generation=await worker(f);assert.equal(generation.jobType,"report.generation");assert.equal(generation.status,"succeeded");
  const jobs=await f.database.query("SELECT * FROM platform_outbox_jobs WHERE job_type='email.report.ready'");
  assert.equal(jobs.rows.length,1,"The actual generation producer must enqueue its requested email");
  const delivery=await mail(f,saved.reportId);assert.equal(delivery.status,"queued");
  const bytes=await f.storage.read(delivery.artifact_key);assert.ok(bytes.byteLength);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),delivery.artifact_sha256);
  assert.deepEqual(jobs.rows[0].payload,{deliveryRef:delivery.delivery_ref});
  assert.equal(jobs.rows[0].enqueued_system_component,"outbox-worker");
  for(const key of ["tenant_id","membership_id","enqueued_by_account_id","enqueued_by_role"])assert.equal(jobs.rows[0][key],null);
  await assert.rejects(f.database.query("UPDATE report_email_deliveries SET recipient_address_hash=$2 WHERE delivery_ref=$1",[delivery.delivery_ref,"f".repeat(64)]),/immutable/);
  local=await provider(f);
  const outbox=new DatabaseOutboxRepository(Promise.resolve(f.database)),claimed=await outbox.claimNext(createTrustedOutboxWorker());
  assert.equal(claimed.job.jobType,"email.report.ready");
  assert.equal((await processReportEmailJob(claimed.job,claimed.lease,f.database)).kind,"succeeded");
  assert.equal((await processReportEmailJob(claimed.job,claimed.lease,f.database)).kind,"succeeded");
  assert.equal(local.calls.length,1,"An accepted delivery is idempotent under repeated active execution");
  const sent=await mail(f,saved.reportId);assert.equal(sent.status,"sent");assert.ok(sent.sent_at);
  assert.equal(sent.provider_reference_hash,createHash("sha256").update("report_provider_local_accepted").digest("hex"));
  assert.deepEqual(local.calls[0].body.to,[f.credentials.company.email]);
  assert.equal(local.calls[0].headers["idempotency-key"],claimed.job.idempotencyKey);
  assert.deepEqual(Object.keys(local.calls[0].body).sort(),["from","subject","text","to"]);
  assert.ok(local.calls[0].body.text.includes(local.origin+"/api/company/reports/"+saved.reportId+"/export"));
  assert.equal(local.calls[0].body.text.includes(f.link.linkId),false,"The email contains no report data");
  assert.deepEqual(Buffer.from((await service(f).download(f.principal,saved.reportId)).bytes),Buffer.from(bytes));
  assert.equal((await outbox.succeed(claimed.lease)).status,"succeeded");
  await assert.rejects(f.database.query("UPDATE report_email_deliveries SET status='queued',provider_reference_hash=NULL,sent_at=NULL WHERE delivery_ref=$1",[sent.delivery_ref]),/immutable/);
  assert.equal(await worker(f),null);
 }finally{if(local)await local.cleanup();await f.cleanup();}
});
test("A queued report email rechecks current export access before any provider call",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();let local;
 try{
  const saved=await service(f).queue(request(f,"report_email_permission_denied"),f.principal);
  assert.equal((await worker(f)).status,"succeeded");
  const queued=await mail(f,saved.reportId);assert.ok(queued);
  local=await provider(f);await reportDenyExport(f);
  const result=await worker(f);assert.equal(result.jobType,"email.report.ready");assert.equal(result.status,"terminal_failed");
  assert.equal(local.calls.length,0);const failed=await mail(f,saved.reportId);assert.equal(failed.status,"failed");assert.equal(failed.last_error_code,"report_email_denied");
  assert.equal(failed.provider_reference_hash,null);assert.equal(failed.sent_at,null);
 }finally{if(local)await local.cleanup();await f.cleanup();}
});

test("A genuine email lease cannot dispatch with an altered job idempotency key",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();let local;
 try{
  const saved=await service(f).queue(request(f,"report_email_bound_dispatch_key"),f.principal);
  assert.equal((await worker(f)).status,"succeeded");
  local=await provider(f);
  const outbox=new DatabaseOutboxRepository(Promise.resolve(f.database)),claimed=await outbox.claimNext(createTrustedOutboxWorker());
  assert.equal(claimed.job.jobType,"email.report.ready");
  let refused=false;
  try{await processReportEmailJob({...claimed.job,idempotencyKey:"f".repeat(64)},claimed.lease,f.database);}
  catch{refused=true;}
  assert.equal(local.calls.length,0,"A copied dispatch key must not reach the real HTTP transport");
  assert.equal(refused,true);
  assert.notEqual((await mail(f,saved.reportId)).status,"sent");
  assert.equal((await processReportEmailJob(claimed.job,claimed.lease,f.database)).kind,"succeeded");
  assert.equal(local.calls.length,1);assert.equal((await mail(f,saved.reportId)).status,"sent");
  assert.equal(local.calls[0].headers["idempotency-key"],claimed.job.idempotencyKey);
 }finally{if(local)await local.cleanup();await f.cleanup();}
});

test("A verified owner address change cannot roll back the generated report",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();let local;
 try{
  const saved=await service(f).queue(request(f,"report_email_address_changed"),f.principal);
  await f.database.query("UPDATE auth_accounts SET email_normalized=$2,email_verified_at=CURRENT_TIMESTAMP WHERE account_id=$1",
   [f.credentials.company.accountId,"changed-report-owner@example.test"]);
  const generation=await worker(f);
  assert.equal(generation.status,"succeeded","Email eligibility failure must not undo real report generation");
  const downloaded=await service(f).download(f.principal,saved.reportId);
  assert.equal(downloaded.delivery.status,"delivered");assert.ok(downloaded.bytes.byteLength);
  const queued=await mail(f,saved.reportId);assert.equal(queued.status,"queued");
  assert.equal(queued.recipient_address_hash,createHash("sha256").update(f.credentials.company.email.trim().toLowerCase()).digest("hex"));
  local=await provider(f);
  const dispatched=await worker(f);assert.equal(dispatched.jobType,"email.report.ready");assert.equal(dispatched.status,"terminal_failed");
  assert.equal(local.calls.length,0);assert.equal((await mail(f,saved.reportId)).status,"failed");
  const after=await service(f).download(f.principal,saved.reportId);
  assert.equal(after.delivery.artifactSha256,downloaded.delivery.artifactSha256);
  assert.deepEqual(Buffer.from(after.bytes),Buffer.from(downloaded.bytes));
 }finally{if(local)await local.cleanup();await f.cleanup();}
});

test("Actual Worker report bytes enqueue an owner-only link and a revoked Worker role denies dispatch",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();let local;
 try{
  const reports=new WorkerReportService(Promise.resolve(f.database),f.storage),saved=await reports.queue(f.worker,{
   reportId:"report_worker_"+randomBytes(12).toString("hex"),reportType:"identity-verification-summary",format:"csv",requestedAt:new Date().toISOString(),queueEmail:true});
  assert.equal((await worker(f)).status,"succeeded");local=await provider(f);
  const delivered=await worker(f);assert.equal(delivered.jobType,"email.report.ready");assert.equal(delivered.status,"succeeded");
  assert.equal(local.calls.length,1);assert.deepEqual(local.calls[0].body.to,[f.credentials.worker.email]);
  assert.ok(local.calls[0].body.text.includes("/api/worker/reports/"+saved.reportId+"/export"));
  assert.equal(local.calls[0].body.text.includes(f.worker.accountId),false);
  const second=await reports.queue(f.worker,{reportId:"report_worker_"+randomBytes(12).toString("hex"),reportType:"identity-verification-summary",
   format:"csv",requestedAt:new Date().toISOString(),queueEmail:true});
  assert.equal((await worker(f)).status,"succeeded");await f.database.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='worker'",[f.worker.accountId]);
  assert.equal((await worker(f)).status,"terminal_failed");assert.equal(local.calls.length,1);assert.equal((await mail(f,second.reportId)).status,"failed");
 }finally{if(local)await local.cleanup();await f.cleanup();}
});
test("Forged leases and changed private report bytes cannot reach email transport",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();let local;
 try{
  const saved=await service(f).queue(request(f,"report_email_forged_lease"),f.principal);assert.equal((await worker(f)).status,"succeeded");
  local=await provider(f);
  const repository=new DatabaseOutboxRepository(Promise.resolve(f.database)),claimed=await repository.claimNext(createTrustedOutboxWorker());
  assert.equal(claimed.job.jobType,"email.report.ready");
  await assert.rejects(processReportEmailJob(claimed.job,{...claimed.lease},f.database));
  assert.equal(local.calls.length,0);assert.equal((await mail(f,saved.reportId)).status,"queued");
  const queued=await mail(f,saved.reportId);
  await writeFile(join(f.directory,".data","private-objects",queued.artifact_key),Buffer.from("Altered private report bytes"),{mode:0o600});
  const refused=await processReportEmailJob(claimed.job,claimed.lease,f.database);
  assert.equal(refused.kind,"retryable");assert.equal(local.calls.length,0);
  assert.equal((await mail(f,saved.reportId)).status,"retry_wait");assert.equal((await mail(f,saved.reportId)).provider_reference_hash,null);
 }finally{if(local)await local.cleanup();await f.cleanup();}
});
test("The fifth expired report-email lease closes only email delivery and preserves its report artifact",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();let local;
 try{
  const saved=await service(f).queue(request(f,"report_email_expired_final_lease"),f.principal);assert.equal((await worker(f)).status,"succeeded");local=await provider(f);
  const repository=new DatabaseOutboxRepository(Promise.resolve(f.database)),email=await mail(f,saved.reportId);
  for(let attempt=1;attempt<=4;attempt++){
   const claimed=await repository.claimNext(createTrustedOutboxWorker());assert.equal(claimed.job.jobId,email.send_job_id);assert.equal(claimed.job.attemptCount,attempt);
   await repository.retry(claimed.lease,{code:"report_email_retry",summary:"Disposable report-email lease fixture."});
   await f.database.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[email.send_job_id]);
  }
  const last=await repository.claimNext(createTrustedOutboxWorker());assert.equal(last.job.jobId,email.send_job_id);
  await f.database.query("UPDATE platform_outbox_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1",[email.send_job_id]);
  assert.equal(await worker(f),null);assert.equal(local.calls.length,0);
  assert.equal((await mail(f,saved.reportId)).status,"failed");assert.equal((await mail(f,saved.reportId)).last_error_code,"report_email_exhausted");
  assert.equal((await service(f).download(f.principal,saved.reportId)).delivery.status,"delivered");
 }finally{if(local)await local.cleanup();await f.cleanup();}
});
