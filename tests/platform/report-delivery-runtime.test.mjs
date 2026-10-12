import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
import { reportCompanyFixture } from "../helpers/report-company-fixture.mjs";
const { ReportDeliveryService } = loadWorkerRegistrationTs("src/lib/reports/report-delivery-service.ts");
const { ReportDeliveryRepository } = loadWorkerRegistrationTs("src/lib/reports/report-delivery-repository.ts");

test("M3.06 service acknowledges only a membership-bound durable generation request", { timeout: 120000 }, async () => {
  const fixture = await reportCompanyFixture();
  try {
    const service = new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(fixture.database)), fixture.storage);
    const result = await service.queue({
      reportId: "report_service_durable_request", tenantId: fixture.credentials.company.tenantId,
      requestedBy: fixture.credentials.company.accountId, format: "csv", requestedAt: new Date().toISOString()
    }, fixture.principal);
    const job = (await fixture.database.query("SELECT * FROM platform_outbox_jobs WHERE job_id=$1", [result.generationJobId])).rows[0];
    assert.equal(job.job_type, "report.generation");
    assert.deepEqual(job.payload, { reportRef: result.reportId });
    assert.equal(job.membership_id, fixture.credentials.company.membershipId);
    await assert.rejects(service.download(fixture.principal, result.reportId), /not available/);
  } finally { await fixture.cleanup(); }
});

test("M3.06 service denies an unauthenticated request without persisting a report or job", { timeout: 120000 }, async () => {
  const fixture = await reportCompanyFixture();
  try {
    const service = new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(fixture.database)), fixture.storage);
    await assert.rejects(service.queue({
      reportId: "report_service_no_principal", tenantId: fixture.credentials.company.tenantId,
      requestedBy: fixture.credentials.company.accountId, format: "pdf", requestedAt: new Date().toISOString()
    }), /denied/);
    assert.equal((await fixture.database.query("SELECT * FROM report_deliveries")).rows.length, 0);
    assert.equal((await fixture.database.query("SELECT * FROM platform_outbox_jobs WHERE job_type='report.generation'")).rows.length, 0);
  } finally { await fixture.cleanup(); }
});
