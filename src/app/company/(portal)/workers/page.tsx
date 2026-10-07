import Link from "next/link";

import { CompanyWorkforcePrintButton } from "@/components/company/company-workforce-print-button";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getCompanyOrganizationRepository } from "@/lib/company/company-organization-repository";
import { getCompanyWorkforceDirectoryService } from "@/lib/company/company-workforce-directory-service";

type SearchParams = Promise<{
  q?: string;
  status?: string;
  site?: string;
  department?: string;
  assurance?: string;
  page?: string;
}>;

export default async function CompanyWorkersPage({
  searchParams
}: {
  searchParams: SearchParams;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const [workforcePrincipal, tenantReadPrincipal] = await Promise.all([
    requireCurrentTenantPermission("company.workforce.manage"),
    requireCurrentTenantPermission("company.tenant.read")
  ]);
  const organization = getCompanyOrganizationRepository();
  const [result, sites, departments] = await Promise.all([
    getCompanyWorkforceDirectoryService().search(workforcePrincipal, {
      query: params.q,
      status: params.status,
      siteId: params.site,
      departmentId: params.department,
      assuranceStatus: params.assurance,
      page: Number(params.page ?? "1")
    }),
    organization.list(tenantReadPrincipal, "site"),
    organization.list(tenantReadPrincipal, "department")
  ]);
  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries({
    q: params.q, status: params.status, site: params.site,
    department: params.department, assurance: params.assurance
  })) if (value) exportParams.set(key, value);

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  function pageHref(page: number): string {
    const query = new URLSearchParams(exportParams);
    query.set("page", String(page));
    return `?${query.toString()}`;
  }


  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company workforce</p>
          <h1>Workers</h1>
          <p className="page-intro">
            Search only Workers linked to this company. Results are filtered on the server and never expose private evidence or unrelated employers.
          </p>
        </div>
        <div className="button-row">
          <a className="button button-secondary" href={`/api/company/workers/export?${exportParams.toString()}`}>Export CSV</a>
          <CompanyWorkforcePrintButton />
          <Link className="button button-primary" href="/company/invitations">Add Workers</Link>
        </div>
      </header>

      <section className="surface-card">
        <form method="get" className="form-grid" aria-label="Workforce filters">
          <label>Search<input name="q" defaultValue={params.q ?? ""} placeholder="Name, email or Worker ID" /></label>
          <label>Status<select name="status" defaultValue={params.status ?? ""}>
            <option value="">All link statuses</option>
            <option value="active">Active</option>
            <option value="pending_worker_acceptance">Pending acceptance</option>
            <option value="revoked">Revoked</option>
          </select></label>
          <label>Site<select name="site" defaultValue={params.site ?? ""}>
            <option value="">All sites</option>
            {sites.map((site) => <option key={site.unitId} value={site.unitId}>{site.name}</option>)}
          </select></label>
          <label>Department<select name="department" defaultValue={params.department ?? ""}>
            <option value="">All departments</option>
            {departments.map((department) => <option key={department.unitId} value={department.unitId}>{department.name}</option>)}
          </select></label>
          <label>Assurance state<input name="assurance" defaultValue={params.assurance ?? ""} placeholder="e.g. Assessment pending" /></label>
          <button className="button button-primary" type="submit">Apply filters</button>
        </form>
      </section>

      <section className="surface-card">
        <div className="page-heading-row">
          <h2>Directory</h2>
          <p>{result.total} matching Worker{result.total === 1 ? "" : "s"}</p>
        </div>
        {result.rows.length === 0 ? <p>No Workers match these filters.</p> : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Worker</th><th>Worker ID</th><th>Site / department</th><th>Link</th><th>Assurance</th><th>Action</th></tr></thead>
              <tbody>{result.rows.map((row) => (
                <tr key={row.linkId}>
                  <td><strong>{row.name}</strong><br /><span className="muted-copy">{row.email}</span></td>
                  <td><code>{row.workerId ?? "Pending"}</code></td>
                  <td>{row.site ?? "—"} / {row.department ?? "—"}</td>
                  <td>{row.status.replaceAll("_", " ")}</td>
                  <td>{row.assuranceStatus ?? "No active case"}{row.nextAction ? <><br /><span className="muted-copy">{row.nextAction}</span></> : null}</td>
                  <td><Link href={`/company/workers/${row.linkId}`}>View company-scoped report</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="button-row" aria-label="Directory pagination">
          {result.page > 1 ? <Link className="button button-secondary" href={pageHref(result.page - 1)}>Previous</Link> : null}
          <span>Page {result.page} of {pages}</span>
          {result.page < pages ? <Link className="button button-secondary" href={pageHref(result.page + 1)}>Next</Link> : null}
        </div>
      </section>
    </div>
  );
}
