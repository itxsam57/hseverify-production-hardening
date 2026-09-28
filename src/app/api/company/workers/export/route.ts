import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getCompanyWorkforceDirectoryService } from "@/lib/company/company-workforce-directory-service";

function csvCell(value: string | null): string {
  const text = value ?? "";
  return `"${text.replaceAll('"', '""')}"`;
}

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
  const rows = [
    ["Name","Email","Worker ID","Site","Department","Link status","Assurance status","Next action"].map(csvCell).join(","),
    ...result.rows.map((row) => [
      row.name,row.email,row.workerId,row.site,row.department,row.status,row.assuranceStatus,row.nextAction
    ].map(csvCell).join(","))
  ];
  return new Response(rows.join("\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="hse-verify-workforce.csv"',
      "cache-control": "private, no-store"
    }
  });
}
