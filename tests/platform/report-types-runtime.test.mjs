import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
import { reportCompanyFixture, reportAddSite } from "../helpers/report-company-fixture.mjs";

const { ReportDeliveryRepository } = loadWorkerRegistrationTs("src/lib/reports/report-delivery-repository.ts");
const { ReportDeliveryService } = loadWorkerRegistrationTs("src/lib/reports/report-delivery-service.ts");
const { AssuranceOrderService } = loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");
const { DatabaseOutboxRepository } = loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const { processNextOutboxJob } = loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");

test("A real Company order and case produce a scoped immutable readiness report", { timeout: 120000 }, async () => {
  const fixture = await reportCompanyFixture();
  try {
    const name = "Nórth – Ж", north = await reportAddSite(fixture, name), south = await reportAddSite(fixture, "South");
    await fixture.database.query("UPDATE company_worker_links SET site_id=$2 WHERE link_id=$1", [fixture.link.linkId, north]);
    const orders = new AssuranceOrderService(fixture.database);
    const manager = { ...fixture.principal, authorizedTenantPermission: "company.orders.manage" };
    const order = await orders.createDraft(manager, {
      orderName: "Report readiness order", orderReference: "report-readiness-" + randomUUID(),
      siteId: north, departmentId: null, requestedIdentityChecks: [], requestedEvidenceChecks: [],
      assessmentFrameworkReferences: [], interviewRequired: false, credentialTarget: null,
      deadline: null, effectivePolicyReference: null, companyNotes: null, purchaseOrderReference: null
    });
    await orders.addWorkerTarget(manager, order.orderId, fixture.link.linkId, "worker");
    const validation = await orders.validateOrder(manager, order.orderId);
    assert.equal(validation.ready, true, "The actual Company order producer must accept this case");
    const cases = await orders.submitOrder(manager, order.orderId);
    assert.equal(cases.length, 1); assert.equal(cases[0].workerLinkId, fixture.link.linkId);
    const reports = new ReportDeliveryService(new ReportDeliveryRepository(Promise.resolve(fixture.database)), fixture.storage);
    const delivery = await reports.queue({
      reportId: "report_real_scoped_readiness", reportType: "site-department-readiness", format: "csv",
      tenantId: fixture.credentials.company.tenantId, requestedBy: fixture.credentials.company.accountId,
      requestedAt: new Date().toISOString(), siteId: north
    }, fixture.principal);
    assert.deepEqual(delivery.rows, [{
      "Scope": "Site", "Scope ID": north, "Scope name": name, "Cases": "1",
      "Assured": "0", "Conditional": "0", "Attention": "0", "In progress": "1", "Readiness %": "0"
    }]);
    await fixture.database.query("UPDATE company_sites SET name='Changed after request' WHERE site_id=$1 AND tenant_id=$2", [north, delivery.tenantId]);
    const job = await processNextOutboxJob({ database: fixture.database, repository: new DatabaseOutboxRepository(Promise.resolve(fixture.database)) });
    assert.equal(job.jobType, "report.generation"); assert.equal(job.status, "succeeded");
    const downloaded = await reports.download(fixture.principal, delivery.reportId);
    assert.equal(createHash("sha256").update(downloaded.bytes).digest("hex"), downloaded.delivery.artifactSha256);
    const csv = Buffer.from(downloaded.bytes).toString("utf8");
    assert.ok(csv.includes(name)); assert.ok(csv.includes(north)); assert.equal(csv.includes(south), false);
    assert.equal(csv.includes("Changed after request"), false);
    assert.equal(csv.includes(fixture.credentials.worker.email), false);
    assert.equal(csv.includes(fixture.credentials.worker.accountId), false);
  } finally { await fixture.cleanup(); }
});
