import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomBytes} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import {reportCompanyFixture,reportNativePrincipal,reportAddWorkerPrincipal} from "../helpers/report-company-fixture.mjs";
const {WorkerReportService}=loadWorkerRegistrationTs("src/lib/reports/worker-report-service.ts");
const {WorkerEvidenceService}=loadWorkerRegistrationTs("src/lib/worker-evidence/worker-evidence-service.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
const {WORKER_REPORT_TYPES,REPORT_HEADERS}=loadWorkerRegistrationTs("src/lib/reports/report-types.ts");
const id=()=>"report_worker_"+randomBytes(12).toString("hex");
const reports=f=>new WorkerReportService(Promise.resolve(f.database),f.storage);
const request=(reportType,format="csv")=>({reportId:id(),reportType,format,requestedAt:new Date().toISOString()});
const worker=f=>processNextOutboxJob({database:f.database,repository:new DatabaseOutboxRepository(Promise.resolve(f.database))});
async function qualification(f,title){
 const evidence=new WorkerEvidenceService(Promise.resolve(f.database));
 const draft=await evidence.createDraft(f.worker,"qualification");
 const saved=await evidence.saveQualificationDraft(f.worker,{recordId:draft.recordId,expectedRevision:draft.currentVersion.revision,
  title,category:"Safety",issuingOrganization:"Owned Institute",learningProvider:null,certificateNumber:"private-certificate-marker",
  issueDate:"2026-01-01",expiryDate:null,level:"3",country:"PK",verificationUrl:null,declarationAccepted:true});
 return {evidence,record:saved};
}
test("A real Worker qualification producer yields an immutable private CSV through the registered report worker",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try{
  const title="=SUM(1,2) José Иван <script>";
  const evidence=await qualification(f,title),input=request("qualification"),service=reports(f);
  const first=await service.queue(f.worker,input),again=await service.queue(f.worker,input);
  assert.equal(first.generationJobId,again.generationJobId);
  assert.equal(first.rows.length,1);assert.equal(first.rows[0]["Title"],title);assert.equal(first.rows[0]["Status"],"draft");
  await evidence.evidence.saveQualificationDraft(f.worker,{recordId:evidence.record.recordId,expectedRevision:evidence.record.currentVersion.revision,
   ...evidence.record.currentVersion.details,title:"Changed after request"});
  assert.equal((await worker(f)).status,"succeeded");
  const download=await service.download(f.worker,input.reportId),csv=Buffer.from(download.bytes).toString("utf8");
  assert.equal(download.delivery.status,"delivered");assert.ok(csv.includes("\"'=SUM(1,2) José Иван <script>\""));
  assert.equal(csv.includes("private-certificate-marker"),false);
  assert.equal(createHash("sha256").update(download.bytes).digest("hex"),download.delivery.artifactSha256);
  assert.equal(download.delivery.rows[0]["Title"],title,"The captured version remains immutable after source edit.");
  assert.equal((await f.database.query("SELECT payload FROM platform_outbox_jobs WHERE job_id=$1",[first.generationJobId])).rows[0].payload.reportRef,input.reportId);
  await assert.rejects(service.download(f.principal,input.reportId),/denied/);
  await f.database.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='Report Worker fixture revocation' WHERE session_id=$1",[f.worker.sessionId]);
  await assert.rejects(service.download(f.worker,input.reportId),/denied/);
 }finally{await f.cleanup();}
});
test("All Worker report kinds use their fixed owned schema and actual registered generation",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try{
  await qualification(f,"Worker snapshot qualification");
  for(const kind of WORKER_REPORT_TYPES){
   const saved=await reports(f).queue(f.worker,request(kind,"print"));
   assert.deepEqual(saved.headers,[...REPORT_HEADERS[kind]]);
   assert.equal(saved.requestedBy,f.worker.accountId);
   for(const row of saved.rows)assert.deepEqual(Object.keys(row).sort(),[...REPORT_HEADERS[kind]].sort());
   const job=await worker(f);assert.equal(job.jobType,"report.generation");assert.equal(job.status,"succeeded",kind);
   const download=await reports(f).download(f.worker,saved.reportId),html=Buffer.from(download.bytes).toString("utf8");
   assert.ok(html.startsWith("<!doctype html>"));assert.equal(html.includes("private-certificate-marker"),false);
   assert.equal(createHash("sha256").update(download.bytes).digest("hex"),download.delivery.artifactSha256);
  }
 }finally{await f.cleanup();}
});
test("Worker requests reject invalid IDs, foreign credentials, altered config, wrong roles and expired sessions",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try{
  const service=reports(f),input=request("identity-verification-summary");
  await assert.rejects(service.queue(f.worker,{...input,reportId:"report_raw_unowned"}),/invalid/);
  await assert.rejects(service.queue(f.principal,input),/denied/);
  await assert.rejects(service.queue(f.worker,{...input,filters:{sql:"SELECT private"}}),/invalid/);
  await assert.rejects(service.queue(f.worker,{...request("credential-pdf"),filters:{credentialId:"credential_id_foreign"}}),/not owned/);
  const saved=await service.queue(f.worker,input);
  await assert.rejects(service.queue(f.worker,{...input,format:"pdf"}),/cannot be changed/);
  await assert.rejects(f.database.query("UPDATE worker_report_deliveries SET snapshot_rows='[]'::jsonb WHERE report_id=$1",[saved.reportId]),/immutable/);
  await f.database.query("UPDATE auth_sessions SET created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE session_id=$1",[f.worker.sessionId]);
  await assert.rejects(service.workspace(f.worker),/denied/);
 }finally{await f.cleanup();}
});
test("The final expired Worker generation lease closes its report and an owner can create a bounded retry",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try{
  const service=reports(f),saved=await service.queue(f.worker,request("identity-verification-summary"));
  const repository=new DatabaseOutboxRepository(Promise.resolve(f.database));
  for(let attempt=1;attempt<=4;attempt++){
   const claimed=await repository.claimNext(createTrustedOutboxWorker());
   assert.equal(claimed.job.jobId,saved.generationJobId);assert.equal(claimed.job.attemptCount,attempt);
   await repository.retry(claimed.lease,{code:"report_generation_retry",summary:"Disposable report generation retry fixture."});
   await f.database.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[saved.generationJobId]);
  }
  const claimed=await repository.claimNext(createTrustedOutboxWorker());assert.equal(claimed.job.jobId,saved.generationJobId);
  await f.database.query("UPDATE platform_outbox_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1",[saved.generationJobId]);
  assert.equal(await worker(f),null);
  const failed=(await service.workspace(f.worker)).reports.find(row=>row.reportId===saved.reportId);
  assert.equal(failed.status,"failed");assert.equal(failed.jobStatus,"terminal_failed");
  const retried=await service.retry(f.worker,saved.reportId);assert.equal(retried.generationVersion,2);assert.notEqual(retried.generationJobId,saved.generationJobId);
  assert.equal((await worker(f)).status,"succeeded");
  assert.ok((await service.download(f.worker,saved.reportId)).bytes.byteLength);
 }finally{await f.cleanup();}
});

test("Worker scheduled generation waits for its due time and a fresh owner session downloads after the origin expires",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try{
  const service=reports(f),scheduleAt=new Date(Date.now()+1500).toISOString(),saved=await service.queue(f.worker,{...request("identity-verification-summary"),scheduleAt});
  assert.equal(saved.status,"scheduled");assert.equal(await worker(f),null,"No generation may run before its due time");
  await f.database.query("UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP-interval '1 millisecond' WHERE session_id=$1",[f.worker.sessionId]);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(scheduleAt)-Date.now()+100)));
  assert.equal((await worker(f)).status,"succeeded","An expired origin session does not revoke valid background ownership");
  await assert.rejects(service.download(f.worker,saved.reportId),/denied/);
  const fresh=await reportNativePrincipal(f.database,f.credentials.worker),foreign=await reportAddWorkerPrincipal(f);
  const downloaded=await service.download(fresh,saved.reportId);assert.ok(downloaded.bytes.byteLength);
  await assert.rejects(service.download(foreign,saved.reportId),/not found|denied/);
  assert.equal((await service.workspace(foreign)).reports.length,0);
  await assert.rejects(service.retry(foreign,saved.reportId),/not found|denied/);
 }finally{await f.cleanup();}
});
test("Worker private artifact tampering and revoked owner roles cannot produce bytes",{timeout:120000},async()=>{
 const f=await reportCompanyFixture();
 try{
  const service=reports(f),saved=await service.queue(f.worker,request("identity-verification-summary"));
  assert.equal((await worker(f)).status,"succeeded");
  const good=await service.download(f.worker,saved.reportId);assert.ok(good.bytes.byteLength);
  await writeFile(join(f.directory,".data","private-objects",good.delivery.artifactKey),Buffer.from("Changed private artifact bytes"),{mode:0o600});
  await assert.rejects(service.download(f.worker,saved.reportId),/not available/);
  await f.database.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='worker'",[f.worker.accountId]);
  await assert.rejects(service.workspace(f.worker),/denied/);
  await assert.rejects(service.download(f.worker,saved.reportId),/denied/);
 }finally{await f.cleanup();}
});
