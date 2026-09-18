export const REPORT_FORMATS = ["pdf", "csv", "print"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_STATUSES = ["queued", "scheduled", "processing", "delivered", "failed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type AuthorizedReportDelivery = Readonly<{
  tenantId: string;
  requestedBy: string;
  reportId: string;
  format: ReportFormat;
}>;

export type ReportExportRequest = Readonly<{
  reportId: string;
  tenantId: string;
  requestedBy: string;
  format: ReportFormat;
  requestedAt: string;
  scheduleAt?: string;
}>;

export type ReportExportResult = Readonly<{
  reportId: string;
  tenantId: string;
  format: ReportFormat;
  status: ReportStatus;
  deliveryKey: string;
  requestedBy: string;
}>;

const REPORT_ID = /^report_[A-Za-z0-9_-]{3,80}$/;

export function createReportExportRequest(input: ReportExportRequest): ReportExportResult {
  if (!REPORT_ID.test(input.reportId)) {
    throw new Error("Report id is invalid.");
  }
  if (!input.tenantId.trim()) {
    throw new Error("Tenant is required.");
  }
  if (!input.requestedBy.trim()) {
    throw new Error("Requester is required.");
  }
  if (!REPORT_FORMATS.includes(input.format)) {
    throw new Error("Report format is invalid.");
  }
  if (input.scheduleAt && Number.isNaN(Date.parse(input.scheduleAt))) {
    throw new Error("Schedule time is invalid.");
  }

  return Object.freeze({
    reportId: input.reportId,
    tenantId: input.tenantId,
    format: input.format,
    status: input.scheduleAt ? "scheduled" : "queued",
    requestedBy: input.requestedBy,
    deliveryKey: `report.delivery.${input.tenantId}.${input.reportId}.${input.format}`
  });
}

export function assertReportTransition(
  current: ReportStatus,
  next: ReportStatus
): void {
  const allowed: Record<ReportStatus, readonly ReportStatus[]> = {
    queued: ["processing", "failed"],
    scheduled: ["queued", "failed"],
    processing: ["delivered", "failed"],
    delivered: [],
    failed: ["queued", "processing"]
  };

  if (!allowed[current].includes(next)) {
    throw new Error("Report delivery transition is invalid.");
  }
}

export function assertReportDeliveryAuthorization(
  request: AuthorizedReportDelivery,
  owner: Readonly<{ tenantId: string; userId: string }>
): void {
  if (request.tenantId !== owner.tenantId || request.requestedBy !== owner.userId) {
    throw new Error("Report delivery is not authorized.");
  }
}

export function assertReportTenantAccess(
  request: Readonly<{ tenantId: string }>,
  tenant: string
): void {
  if (request.tenantId !== tenant) {
    throw new Error("Report tenant access denied.");
  }
}

export function createReportCsv(rows: readonly Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const safeCell = (value: string): string => {
    const escaped = value.replaceAll('"', '""');
    const protectedValue = /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped;
    return `"${protectedValue}"`;
  };

  return [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ""))]
    .map((line) => line.map(safeCell).join(","))
    .join("\n");
}

export function createPrintDeliveryPayload(reportId: string): Readonly<{ reportId: string; mode: "print" }> {
  if (!REPORT_ID.test(reportId)) {
    throw new Error("Report id is invalid.");
  }
  return Object.freeze({ reportId, mode: "print" as const });
}

export function createReportPdf(reportId: string, title: string): string {
  if (!REPORT_ID.test(reportId)) {
    throw new Error("Report id is invalid.");
  }
  if (!title.trim()) {
    throw new Error("Report title is required.");
  }

  // Minimal PDF boundary kept deterministic for the local delivery adapter.
  // Production object storage/signing can consume this generated artifact later.
  const body = `HSE Verify Report\n${title}\n${reportId}`;
  return `%PDF-1.4\n1 0 obj<<>>endobj\n2 0 obj<< /Length ${body.length} >>stream\n${body}\nendstream endobj\n%%EOF`;
}
