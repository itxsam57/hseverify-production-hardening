import {isCompanyReportType,normalizeReportFilters,type CompanyReportType,type ReportFilters,type ReportRow,type ReportSourceReference} from "./report-types";
export const REPORT_FORMATS = ["pdf", "csv", "print"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export const REPORT_STATUSES = ["queued", "scheduled", "processing", "delivered", "failed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_TYPE = "workforce-status" as const;
export const WORKFORCE_REPORT_HEADERS = [
  "Worker ID", "Worker link", "Worker status", "Site ID", "Department ID", "Company case status"
] as const;
export type ReportScope = Readonly<{ siteId: string | null; departmentId: string | null }>;
export type WorkforceReportRow = Readonly<Record<(typeof WORKFORCE_REPORT_HEADERS)[number], string>>;
export type AuthorizedReportDelivery = Readonly<{
  tenantId: string; requestedBy: string; reportId: string; format: ReportFormat;
}>;
export type ReportExportRequest = AuthorizedReportDelivery & Readonly<{
  requestedAt: string; scheduleAt?: string; reportType?: CompanyReportType; filters?: Partial<ReportFilters>; definitionId?: string | null; definitionVersion?: number | null;
  siteId?: string | null; departmentId?: string | null; queueEmail?: boolean;
}>;
export type ReportExportResult = AuthorizedReportDelivery & Readonly<{
  status: ReportStatus; deliveryKey: string;
}>;
export type ReportDeliveryRecord = ReportExportResult & Readonly<{
  reportType: CompanyReportType; membershipId: string; requestedAt: string;
  scheduleAt: string | null; scope: ReportScope; rows: readonly ReportRow[]; headers: readonly string[];
  sourceProvenance: readonly ReportSourceReference[]; filters: ReportFilters; definitionId: string | null; definitionVersion: number | null; canAccessSnapshot: boolean;
  generationJobId: string; generationVersion: number; artifactKey: string | null;
  artifactSha256: string | null; artifactByteSize: number | null; artifactMimeType: string | null;
  generatedAt: string | null; lastErrorCode: string | null; jobStatus: string | null;
  queueEmail: boolean; recipientAddressHash: string | null; emailStatus: string | null;
}>;
export class ReportInputError extends Error {
  constructor(message = "The report request is invalid.") { super(message); this.name = "ReportInputError"; }
}
export class ReportAccessError extends Error {
  constructor() { super("Report access denied."); this.name = "ReportAccessError"; }
}
export class ReportConflictError extends Error {
  constructor(message = "This report request cannot be changed.") { super(message); this.name = "ReportConflictError"; }
}
export class ReportNotFoundError extends Error {
  constructor() { super("Report not found."); this.name = "ReportNotFoundError"; }
}
export class ReportArtifactUnavailableError extends Error {
  constructor() { super("The generated report is not available."); this.name = "ReportArtifactUnavailableError"; }
}
export function normalizeReportId(value: string): string {
  if (typeof value !== "string" || !/^report_[A-Za-z0-9_-]{3,80}$/.test(value)) throw new ReportInputError("Report id is invalid.");
  return value;
}
export function normalizeReportScope(input: { siteId?: string | null; departmentId?: string | null }): ReportScope {
  const unit = (value: string | null | undefined, prefix: string): string | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || !new RegExp("^" + prefix + "_[A-Za-z0-9_-]{24}$").test(value)) throw new ReportInputError("Report scope is invalid.");
    return value;
  };
  return Object.freeze({ siteId: unit(input.siteId, "site"), departmentId: unit(input.departmentId, "department") });
}
export function createReportExportRequest(input: ReportExportRequest): ReportExportResult {
  normalizeReportId(input.reportId);
  if (input.reportId.startsWith("report_worker_")) throw new ReportInputError("Worker report namespace is reserved.");
  try { if (normalizeReportFilters(input.filters).credentialId) throw new Error(); } catch { throw new ReportInputError("Report filters are invalid."); }
  if ((input.definitionId == null) !== (input.definitionVersion == null) || (input.definitionId != null &&
      (!/^report_definition_[A-Za-z0-9_-]{24}$/.test(input.definitionId) || !Number.isInteger(input.definitionVersion) ||
       Number(input.definitionVersion)<1 || Number(input.definitionVersion)>1000))) throw new ReportInputError("Saved report version is invalid.");
  if (!input.tenantId?.trim() || !input.requestedBy?.trim()) throw new ReportInputError();
  if (input.queueEmail !== undefined && typeof input.queueEmail !== "boolean") throw new ReportInputError("Email choice is invalid.");
  if (!REPORT_FORMATS.includes(input.format)) throw new ReportInputError("Report format is invalid.");
  if (input.reportType !== undefined && !isCompanyReportType(input.reportType)) throw new ReportInputError("Report type is invalid.");
  if (!Number.isFinite(Date.parse(input.requestedAt))) throw new ReportInputError("Request time is invalid.");
  if (input.scheduleAt && !Number.isFinite(Date.parse(input.scheduleAt))) throw new ReportInputError("Schedule time is invalid.");
  normalizeReportScope(input);
  return Object.freeze({
    reportId: input.reportId, tenantId: input.tenantId, requestedBy: input.requestedBy, format: input.format,
    status: input.scheduleAt ? "scheduled" : "queued",
    deliveryKey: "report.delivery." + input.tenantId + "." + input.reportId + "." + input.format
  });
}
export function assertReportTransition(current: ReportStatus, next: ReportStatus): void {
  const allowed: Record<ReportStatus, readonly ReportStatus[]> = {
    queued: ["processing", "failed"], scheduled: ["queued", "processing", "failed"],
    processing: ["delivered", "failed"], delivered: [], failed: ["queued", "processing"]
  };
  if (!allowed[current].includes(next)) throw new ReportConflictError("Report delivery transition is invalid.");
}
export function assertReportDeliveryAuthorization(
  request: AuthorizedReportDelivery, owner: Readonly<{ tenantId: string; userId: string }>
): void {
  if (request.tenantId !== owner.tenantId || request.requestedBy !== owner.userId) throw new ReportAccessError();
}
export function assertReportTenantAccess(request: Readonly<{ tenantId: string }>, tenant: string): void {
  if (request.tenantId !== tenant) throw new ReportAccessError();
}
export function createReportCsv(
  rows: readonly Readonly<Record<string, string>>[], suppliedHeaders?: readonly string[]
): string {
  if (rows.length === 0 && !suppliedHeaders) return "";
  const headers = suppliedHeaders ?? Object.keys(rows[0]);
  const cell = (value: string): string => {
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return [headers, ...rows.map(row => headers.map(key => row[key] ?? ""))]
    .map(line => line.map(cell).join(",")).join("\n");
}
function html(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
export function createReportPrint(reportId: string, requestedAt: string, rows: readonly ReportRow[],
 headers: readonly string[]=WORKFORCE_REPORT_HEADERS,title="Workforce status report"): string {
  normalizeReportId(reportId);
  const cells = rows.map(row => "<tr>" + headers.map(key => "<td>" + html(row[key] ?? "") + "</td>").join("") + "</tr>").join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + html(title) + '</title>'
    + '<style>body{font:14px system-ui;margin:2rem;color:#17232b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bac6cc;padding:.5rem;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}@media print{body{margin:.5in}tr{break-inside:avoid}}</style>'
    + '</head><body><h1>' + html(title) + '</h1><p>Request ' + html(reportId) + ' · Snapshot ' + html(requestedAt) + '</p>'
    + '<p>Captured report snapshot. Use live verification for current credential validity.</p><table><thead><tr>'
    + headers.map(key => "<th>" + html(key) + "</th>").join("") + "</tr></thead><tbody>"
    + (cells || '<tr><td colspan="' + headers.length + '">No records match this report.</td></tr>') + "</tbody></table></body></html>";
}
