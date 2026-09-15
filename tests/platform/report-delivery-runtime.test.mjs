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
