import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getCompanyWorkforceDirectoryService } from "@/lib/company/company-workforce-directory-service";
import { createReportCsv } from "@/lib/reports/report-delivery-domain";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const principal = await requireCurrentTenantPermission("company.workforce.manage");
  const result = await getCompanyWorkforceDirectoryService().search(principal, {
    query: url.searchParams.get("q"),
    status: url.searchParams.get("status"),
    siteId: url.searchParams.get("site"),
    departmentId: url.searchParams.get("department"),
    assuranceStatus: url.searchParams.get("assurance"),
    page: 1,
    pageSize: 100
  });
  const headers = [
    "Name", "Email", "Worker ID", "Site", "Department", "Link status",
    "Assurance status", "Latest case credential status", "Next action"
  ] as const;
  const rows = result.rows.map((row) => ({
    Name: row.name,
    Email: row.email,
    "Worker ID": row.workerId ?? "",
    Site: row.site ?? "",
    Department: row.department ?? "",
    "Link status": row.status,
    "Assurance status": row.assuranceStatus ?? "",
    "Latest case credential status": row.credentialStatus ?? "",
    "Next action": row.nextAction ?? ""
  }));
  // Keep the Company workforce export on the same proven formula-neutralizing
  // CSV path as generated reports. Quoting alone is not spreadsheet-safe.
  return new Response(createReportCsv(rows, headers), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="hse-verify-workforce.csv"',
      "cache-control": "private, no-store"
    }
  });
}
