import assert from "node:assert/strict";
import {parsedReportPdf} from "../helpers/report-artifact-inspection.mjs";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, symlink, unlink, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
import { reportCompanyFixture, reportNativePrincipal, reportAddSite, reportAddDepartment, reportSetScope, reportAddCompanyPrincipal, reportDenyExport } from "../helpers/report-company-fixture.mjs";

const {ReportDeliveryRepository} = loadWorkerRegistrationTs("src/lib/reports/report-delivery-repository.ts");
const {ReportDeliveryService} = loadWorkerRegistrationTs("src/lib/reports/report-delivery-service.ts");
const {DatabaseOutboxRepository} = loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob} = loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");

test("A real Company report request enqueues its generation before acknowledgment", {timeout:120000}, async () => {
  const fixture = await reportCompanyFixture();
  try {
    const repository = new ReportDeliveryRepository(Promise.resolve(fixture.database));
    const service = new ReportDeliveryService(repository, fixture.storage);
    const result = await service.queue({
      reportId: "report_real_workforce_request", tenantId: fixture.credentials.company.tenantId,
      requestedBy: fixture.credentials.company.accountId, format: "csv", requestedAt: new Date().toISOString(),
      reportType: "workforce-status"
    }, fixture.principal);
    const jobs = await fixture.database.query("SELECT * FROM platform_outbox_jobs WHERE job_type='report.generation'");
    assert.equal(jobs.rows.length, 1, "Report requests must enqueue durable generation before acknowledgment");
    assert.equal(jobs.rows[0].payload.reportRef, result.reportId);
  } finally {await fixture.cleanup();}
});

test("The actual queue-to-deliver path cannot announce delivery without workforce bytes", {timeout:120000}, async () => {
  const fixture = await reportCompanyFixture();
  try {
    const repository = new ReportDeliveryRepository(Promise.resolve(fixture.database));
    const service = new ReportDeliveryService(repository, fixture.storage);
    const result = await service.queue({
      reportId: "report_real_workforce_bytes", tenantId: fixture.credentials.company.tenantId,
      requestedBy: fixture.credentials.company.accountId, format: "csv", requestedAt: new Date().toISOString(),
      reportType: "workforce-status"
    }, fixture.principal);
    const job = await processNextOutboxJob({database: fixture.database, repository: new DatabaseOutboxRepository(Promise.resolve(fixture.database))});
    assert.equal(job?.jobType, "report.generation");
    assert.equal(job?.status, "succeeded");
    const stored = (await fixture.database.query("SELECT * FROM report_deliveries WHERE report_id=$1 AND tenant_id=$2", [result.reportId, result.tenantId])).rows[0];
    assert.equal(stored.status, "delivered");
    assert.ok(stored.artifact_key, "Delivered reports require an actual persisted artifact");
    const bytes = await fixture.storage.read(stored.artifact_key);
    assert.ok(bytes?.byteLength, "Delivered reports require actual private bytes");
    assert.match(Buffer.from(bytes).toString("utf8"), /Worker status|Worker ID/);
    assert.equal(Buffer.from(bytes).toString("utf8").includes(fixture.credentials.worker.email), false);
  } finally {await fixture.cleanup();}
});

const {createTrustedOutboxWorker, normalizeOutboxPayload} = loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
const {processReportGenerationJob} = loadWorkerRegistrationTs("src/lib/reports/report-generation-handler.ts");
const {createReportCsv} = loadWorkerRegistrationTs("src/lib/reports/report-delivery-domain.ts");
function reportService(f) {return new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(f.database)), f.storage);}
function reportRequest(f, id, format="csv", extra={}) {return {reportId:id,tenantId:f.credentials.company.tenantId,
  requestedBy:f.credentials.company.accountId,format,requestedAt:new Date().toISOString(),reportType:"workforce-status",...extra};}
function reportWorker(f) {return processNextOutboxJob({database:f.database,repository:new DatabaseOutboxRepository(Promise.resolve(f.database))});}
async function reportRow(f,id) {return (await f.database.query("SELECT * FROM report_deliveries WHERE tenant_id=$1 AND report_id=$2",[f.credentials.company.tenantId,id])).rows[0];}

test("Real CSV, PDF and print artifacts have integrity hashes and immutable request provenance", {timeout:120000}, async () => {
  const f=await reportCompanyFixture();
  try {
    const unsafeNames = ["=SUM(1,1)", " +CMD(1)", "\t@RUN(1)"];
    const site = await reportAddSite(f, unsafeNames[0]), department = await reportAddDepartment(f, unsafeNames[1]);
    await f.database.query("UPDATE auth_accounts SET display_name=$2 WHERE account_id=$1", [f.credentials.worker.accountId, unsafeNames[2]]);
    await f.database.query("UPDATE company_worker_links SET site_id=$2,department_id=$3 WHERE link_id=$1", [f.link.linkId, site, department]);
    for(const format of ["csv","pdf","print"]) {
      const delivery=await reportService(f).queue(reportRequest(f,"report_verified_format_"+format,format),f.principal);
      const duplicate=await reportService(f).queue(reportRequest(f,delivery.reportId,format),f.principal);
      assert.equal(duplicate.generationJobId,delivery.generationJobId);
      await assert.rejects(f.database.query("UPDATE report_deliveries SET status='delivered' WHERE report_id=$1",[delivery.reportId]),/report_delivery_artifact_check/);
      await assert.rejects(f.database.query("UPDATE report_deliveries SET format=$2 WHERE report_id=$1",[delivery.reportId,format==="csv"?"pdf":"csv"]),/immutable/);
      assert.equal((await reportWorker(f)).status,"succeeded");
      const row=await reportRow(f,delivery.reportId), bytes=await f.storage.read(row.artifact_key);
      assert.equal(bytes.byteLength,row.artifact_byte_size);
      assert.equal(createHash("sha256").update(bytes).digest("hex"),row.artifact_sha256);
      assert.equal((await stat(join(f.directory,".data","private-objects",row.artifact_key))).mode&0o777,0o600);
      assert.deepEqual(Buffer.from((await reportService(f).download(f.principal,delivery.reportId)).bytes),Buffer.from(bytes));
      const text=format==="pdf"?parsedReportPdf(bytes):Buffer.from(bytes).toString("utf8");
      assert.ok(text.includes(f.link.linkId));
      assert.ok(text.includes(site)); assert.ok(text.includes(department));
      for (const name of unsafeNames) assert.equal(text.includes(name), false, "Worker-controlled display labels cannot enter the fixed ID/status report");
      assert.ok(text.includes("No Company case"));
      assert.equal(text.includes(f.credentials.worker.email),false);
      assert.equal(text.includes(f.credentials.worker.accountId),false);
      if(format==="pdf") {
        const raw=Buffer.from(bytes).toString("ascii");assert.ok(raw.startsWith("%PDF-1.4\n")); assert.match(raw,/\/Type \/Catalog/); assert.match(raw,/xref\n/);
        await writeFile(join(f.directory,"report-artifact-proof.pdf"),bytes,{mode:0o600});
      } else if(format==="print") {assert.ok(text.startsWith("<!doctype html>"));assert.match(text,/<table>/);assert.equal(text.includes("<script"),false);}
      else assert.ok(text.startsWith('"Worker ID","Worker link","Worker status","Site ID","Department ID","Company case status"\n'));
      await assert.rejects(f.database.query("UPDATE report_deliveries SET artifact_sha256=$2 WHERE report_id=$1",[delivery.reportId,"f".repeat(64)]),/immutable/);
    }
    assert.equal(await reportWorker(f),null);
  } finally {await f.cleanup();}
});

test("Scheduled generation waits and succeeds after the originating session expires", {timeout:120000}, async () => {
  const f=await reportCompanyFixture();
  try {
    const scheduleAt=new Date(Date.now()+1500).toISOString();
    const delivery=await reportService(f).schedule(reportRequest(f,"report_due_after_session","csv",{scheduleAt}),f.principal);
    assert.equal(delivery.status,"scheduled");
    assert.equal(await reportWorker(f),null);
    await f.database.query("UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP-interval '1 millisecond' WHERE session_id=$1",[f.principal.sessionId]);
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(scheduleAt)-Date.now()+100)));
    assert.equal((await reportWorker(f)).status,"succeeded");
    await assert.rejects(reportService(f).download(f.principal,delivery.reportId));
    const fresh=await reportNativePrincipal(f.database,f.credentials.company);
    assert.ok((await reportService(f).download(fresh,delivery.reportId)).bytes.byteLength);
  } finally {await f.cleanup();}
});

test("Member scope, tenant isolation, permission ceiling and fresh session checks hold at the report boundary", {timeout:120000}, async () => {
  const f=await reportCompanyFixture();
  try {
    const north=await reportAddSite(f,"North"), south=await reportAddSite(f,"South");
    await f.database.query("UPDATE company_worker_links SET site_id=$2 WHERE link_id=$1",[f.link.linkId,north]);
    const broad=await reportService(f).queue(reportRequest(f,"report_before_scope"),f.principal);
    assert.equal((await reportWorker(f)).status,"succeeded");
    await reportSetScope(f,north);
    await assert.rejects(reportService(f).download(f.principal,broad.reportId),/denied/);
    await assert.rejects(reportService(f).queue(reportRequest(f,"report_wrong_scope","csv",{siteId:south}),f.principal),/denied/);
    const scoped=await reportService(f).queue(reportRequest(f,"report_north_scope"),f.principal);
    assert.equal(scoped.scope.siteId,north);
    assert.equal((await reportWorker(f)).status,"succeeded");
    const text=Buffer.from((await reportService(f).download(f.principal,scoped.reportId)).bytes).toString("utf8");
    assert.ok(text.includes(north));assert.equal(text.includes(south),false);
    const foreign=await reportAddCompanyPrincipal(f,"owner",true), colleague=await reportAddCompanyPrincipal(f), viewer=await reportAddCompanyPrincipal(f,"viewer");
    await assert.rejects(reportService(f).download(foreign,scoped.reportId),/not found/);
    await assert.rejects(reportService(f).download(colleague,scoped.reportId),/not found/);
    await assert.rejects(reportService(f).queue({...reportRequest(f,"report_viewer_ceiling"),requestedBy:viewer.accountId},viewer));
    await assert.rejects(reportService(f).queue(reportRequest(f,"report_wrong_permission"),{...f.principal,authorizedTenantPermission:"company.audit.read"}));
    await f.database.query("UPDATE auth_sessions SET revoked_at=CURRENT_TIMESTAMP,revocation_reason='Report fixture session revocation' WHERE session_id=$1",[f.principal.sessionId]);
    await assert.rejects(reportService(f).download(f.principal,scoped.reportId));
  } finally {await f.cleanup();}
});

test("Queued generation cannot survive an explicit export permission denial", {timeout:120000}, async () => {
  const f=await reportCompanyFixture();
  try {
    const delivery=await reportService(f).queue(reportRequest(f,"report_permission_denial"),f.principal);
    await reportDenyExport(f);
    assert.equal((await reportWorker(f)).status,"terminal_failed");
    const row=await reportRow(f,delivery.reportId);
    assert.equal(row.status,"failed");assert.equal(row.last_error_code,"report_generation_denied");assert.equal(row.artifact_key,null);
    await assert.rejects(reportService(f).retry(f.principal,delivery.reportId));
    await assert.rejects(reportService(f).queue(reportRequest(f,"report_denied_no_enqueue"),f.principal));
    assert.equal((await f.database.query("SELECT * FROM platform_outbox_jobs WHERE job_type='report.generation'")).rows.length,1);
  } finally {await f.cleanup();}
});

test("Actual private storage errors have bounded retries, final lease expiry and owner recovery", {timeout:120000}, async () => {
  const f=await reportCompanyFixture();
  try {
    const delivery=await reportService(f).queue(reportRequest(f,"report_private_storage_retry"),f.principal);
    await mkdir(join(f.directory,".data"),{recursive:true});
    const bad=join(f.directory,".data","bad-objects"), root=join(f.directory,".data","private-objects");
    await mkdir(bad);await symlink(bad,root);
    for(let attempt=1;attempt<=4;attempt++) {
      const job=await reportWorker(f);assert.equal(job.attemptCount,attempt);assert.equal(job.status,"retry_wait");
      assert.equal((await reportRow(f,delivery.reportId)).artifact_key,null);
      assert.equal(await reportWorker(f),null);
      await f.database.query("UPDATE platform_outbox_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE job_id=$1",[delivery.generationJobId]);
    }
    const outbox=new DatabaseOutboxRepository(Promise.resolve(f.database));
    const finalLease=await outbox.claimNext(createTrustedOutboxWorker());
    assert.equal(finalLease.job.attemptCount,5);
    await f.database.query("UPDATE platform_outbox_jobs SET lease_expires_at=CURRENT_TIMESTAMP-interval '1 millisecond' WHERE job_id=$1",[delivery.generationJobId]);
    assert.equal(await reportWorker(f),null);
    const oldJob=(await f.database.query("SELECT * FROM platform_outbox_jobs WHERE job_id=$1",[delivery.generationJobId])).rows[0];
    assert.equal(oldJob.status,"terminal_failed");
    const failed=await reportRow(f,delivery.reportId);assert.equal(failed.status,"failed");assert.equal(failed.artifact_key,null);
    assert.equal(failed.last_error_code,"report_generation_exhausted");
    const colleague=await reportAddCompanyPrincipal(f);
    await assert.rejects(reportService(f).retry(colleague,delivery.reportId),/not found/);
    await unlink(root);
    const recovered=await reportService(f).retry(f.principal,delivery.reportId);
    assert.equal(recovered.generationVersion,2);assert.notEqual(recovered.generationJobId,delivery.generationJobId);
    assert.equal((await reportWorker(f)).status,"succeeded");
    assert.ok((await reportService(f).download(f.principal,delivery.reportId)).bytes.byteLength);
    assert.equal((await f.database.query("SELECT * FROM platform_outbox_job_attempts WHERE job_id=$1",[delivery.generationJobId])).rows.length,5);
    await assert.rejects(reportService(f).retry(f.principal,delivery.reportId));
  } finally {await f.cleanup();}
});

test("A repeated active generation lease is idempotent and stale leases cannot mutate delivery", {timeout:120000}, async () => {
  const f=await reportCompanyFixture();
  try {
    const delivery=await reportService(f).queue(reportRequest(f,"report_idempotent_lease"),f.principal);
    const outbox=new DatabaseOutboxRepository(Promise.resolve(f.database));
    const claimed=await outbox.claimNext(createTrustedOutboxWorker());
    assert.equal((await processReportGenerationJob(claimed.job,claimed.lease,f.database)).kind,"succeeded");
    const first=await reportRow(f,delivery.reportId);
    assert.equal((await processReportGenerationJob(claimed.job,claimed.lease,f.database)).kind,"succeeded");
    const second=await reportRow(f,delivery.reportId);
    assert.equal(second.artifact_sha256,first.artifact_sha256);assert.equal(second.artifact_key,first.artifact_key);
    assert.equal(String(second.generated_at),String(first.generated_at));
    await outbox.succeed(claimed.lease);
    await assert.rejects(reportService(f).generate(claimed.job,claimed.lease),/denied/);
    await writeFile(join(f.directory,".data","private-objects",first.artifact_key),"tampered",{mode:0o600});
    await assert.rejects(reportService(f).download(f.principal,delivery.reportId),/not available/);
  } finally {await f.cleanup();}
});

test("Strict report payload validation and CSV formula escaping reject unsafe inputs", () => {
  assert.deepEqual(normalizeOutboxPayload("report.generation",{reportRef:"report_valid_123"}),{reportRef:"report_valid_123"});
  for(const payload of [{reportRef:"raw_id"},{reportRef:"report_../../private"},{reportRef:"report_valid_123",tenantId:"forged"},{reportRef:"report_"+ "x".repeat(81)},[]]) assert.throws(()=>normalizeOutboxPayload("report.generation",payload));
  for(const [input,expected] of [["=SUM(1,1)","'=SUM(1,1)"],[" +CMD","' +CMD"],["\t=1","'\t=1"],["\r-1","'\r-1"],["\n@RUN","'\n@RUN"],["\u0000=1","'\u0000=1"],["ordinary","ordinary"]]) assert.equal(createReportCsv([{Cell:input}]),'"Cell"\n"'+expected+'"');
});

test("A lease that expires during actual private artifact storage cannot commit delivery", {timeout:120000}, async () => {
  const f=await reportCompanyFixture();
  try {
    const delivery=await reportService(f).queue(reportRequest(f,"report_expiring_during_storage"),f.principal);
    const outbox=new DatabaseOutboxRepository(Promise.resolve(f.database));
    const claimed=await outbox.claimNext(createTrustedOutboxWorker());
    await f.database.query("UPDATE platform_outbox_jobs SET lease_expires_at=clock_timestamp()+interval '150 milliseconds' WHERE job_id=$1",[delivery.generationJobId]);
    const delayedStorage={
      put:async(key,bytes)=>{const persisted=await f.storage.put(key,bytes);await new Promise(resolve=>setTimeout(resolve,500));return persisted;},
      read:key=>f.storage.read(key)
    };
    let generationError;
    try {await new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(f.database)),delayedStorage).generate(claimed.job,claimed.lease);}
    catch(error){generationError=error;}
    const leaseState=(await f.database.query("SELECT lease_expires_at<=clock_timestamp() AS expired FROM platform_outbox_jobs WHERE job_id=$1",[delivery.generationJobId])).rows[0];
    assert.equal(leaseState.expired,true);
    const row=await reportRow(f,delivery.reportId);
    assert.equal(row.status,"queued","An expired worker lease cannot commit a delivered report after private artifact I/O");
    assert.equal(row.artifact_key,null);
    assert.equal(generationError?.name,"ReportAccessError");
    await assert.rejects(reportService(f).download(f.principal,delivery.reportId),/not available/);
  } finally {await f.cleanup();}
});

test("A matching digest cannot authorize another tenant's private report object", {timeout:120000}, async () => {
  const f=await reportCompanyFixture();
  try {
    const owned=await reportService(f).queue(reportRequest(f,"report_owned_private_object"),f.principal);
    assert.equal((await reportWorker(f)).status,"succeeded");
    const source=await reportRow(f,owned.reportId);
    const foreign=await reportAddCompanyPrincipal(f,"owner",true);
    const {deriveTrustedTenantScope}=loadWorkerRegistrationTs("src/lib/authorization/tenant-scoped-resource-domain.ts");
    const foreignScope=deriveTrustedTenantScope(foreign);
    const forged=await reportService(f).queue({...reportRequest(f,"report_foreign_private_object"),
      tenantId:foreignScope.tenantId,requestedBy:foreign.accountId},foreign);
    // Corrupt metadata only in this private test DB: the file and digest remain genuine.
    await f.database.query("UPDATE report_deliveries SET status='delivered',artifact_key=$3,artifact_sha256=$4,artifact_byte_size=$5,artifact_mime_type=$6,generated_at=clock_timestamp() WHERE tenant_id=$1 AND report_id=$2",
      [foreignScope.tenantId,forged.reportId,source.artifact_key,source.artifact_sha256,source.artifact_byte_size,source.artifact_mime_type]);
    await assert.rejects(reportService(f).download(foreign,forged.reportId),/not available/);
    assert.ok((await reportService(f).download(f.principal,owned.reportId)).bytes.byteLength);
  } finally {await f.cleanup();}
});
