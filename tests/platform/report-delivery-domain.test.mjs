import assert from "node:assert/strict";
import test from "node:test";

import { assertReportDeliveryAuthorization, createReportCsv, createReportExportRequest } from "../../src/lib/reports/report-delivery-domain.ts";

test("M3.06 creates an authorized export delivery request contract", () => {
  const result = createReportExportRequest({
    reportId: "report_case001",
    tenantId: "tenant_a",
    requestedBy: "user_a",
    format: "pdf",
    requestedAt: "2026-09-15T00:00:00Z"
  });

  assert.equal(result.status, "queued");
  assert.equal(result.format, "pdf");
  assert.match(result.deliveryKey, /^report\.delivery\.tenant_a/);
});

test("M3.06 rejects invalid export formats", () => {
  assert.throws(() => createReportExportRequest({
    reportId: "report_case001",
    tenantId: "tenant_a",
    requestedBy: "user_a",
    format: "xml",
    requestedAt: "2026-09-15T00:00:00Z"
  }));
});

test("M3.06 supports scheduled delivery and deterministic CSV export", () => {
  const result = createReportExportRequest({
    reportId: "report_case001",
    tenantId: "tenant_a",
    requestedBy: "user_a",
    format: "csv",
    requestedAt: "2026-09-15T00:00:00Z",
    scheduleAt: "2026-09-16T00:00:00Z"
  });

  assert.equal(result.status, "scheduled");
  assert.equal(createReportCsv([{ name: "A,B" }]), '"name"\n"A,B"');
});

test("M3.06 denies cross tenant report delivery", () => {
  assert.throws(() => assertReportDeliveryAuthorization({
    tenantId: "tenant_a",
    requestedBy: "user_a",
    reportId: "report_case001",
    format: "pdf"
  }, { tenantId: "tenant_b", userId: "user_a" }));
});
