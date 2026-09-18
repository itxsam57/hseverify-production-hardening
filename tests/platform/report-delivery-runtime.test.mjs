import assert from "node:assert/strict";
import test from "node:test";
import { ReportDeliveryService } from "../../src/lib/reports/report-delivery-service.ts";

test("M3.06 queues durable report delivery requests through the service boundary", async () => {
  const saved = [];
  const service = new ReportDeliveryService({
    async save(record, scheduleAt) { saved.push({ record, scheduleAt }); }
  });

  const result = await service.queue({
    reportId: "report_case001",
    tenantId: "tenant_a",
    requestedBy: "user_a",
    format: "csv",
    requestedAt: "2026-09-15T00:00:00Z"
  });

  assert.equal(result.status, "queued");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].record.tenantId, "tenant_a");
});

test("M3.06 delivery moves a queued report through the durable lifecycle", async () => {
  const transitions = [];
  const service = new ReportDeliveryService({
    async save() {},
    async find() { return { reportId: "report_case001" }; },
    async markStatus(reportId, tenantId, status) {
      transitions.push({ reportId, tenantId, status });
    }
  });

  const result = await service.deliver("report_case001", "tenant_a", "pdf");

  assert.equal(result.status, "delivered");
  assert.deepEqual(transitions.map((entry) => entry.status), ["processing", "delivered"]);
});

test("M3.06 delivery cannot process an unknown durable queue item", async () => {
  const service = new ReportDeliveryService({
    async save() {},
    async find() { return null; },
    async markStatus() { throw new Error("should not mark unknown reports"); }
  });

  await assert.rejects(
    () => service.deliver("report_missing", "tenant_a", "pdf"),
    /Report delivery not found\./
  );
});

test("M3.06 delivery cannot cross tenant boundary", async () => {
  const service = new ReportDeliveryService({
    async save() {},
    async find(reportId, tenantId) {
      if (tenantId !== "tenant_owner") return null;
      return { reportId, tenantId };
    },
    async markStatus() { throw new Error("should not update foreign tenant"); }
  });

  await assert.rejects(
    () => service.deliver("report_case001", "tenant_other", "pdf"),
    /Report delivery not found\./
  );
});
