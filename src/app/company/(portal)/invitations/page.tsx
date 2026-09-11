import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getCompanyOrganizationRepository } from "@/lib/company/company-organization-repository";
import { getCompanyWorkforceReadRepository } from "@/lib/company/company-workforce-read-repository";
import { CompanyWorkforceInvitationsWorkspace } from "@/components/company/company-workforce-invitations-workspace";

export default async function CompanyWorkforceInvitationsPage(): Promise<React.JSX.Element> {
  const [workforcePrincipal, tenantReadPrincipal] = await Promise.all([
    requireCurrentTenantPermission("company.workforce.manage"),
    requireCurrentTenantPermission("company.tenant.read")
  ]);
  const organization = getCompanyOrganizationRepository();
  const workforce = getCompanyWorkforceReadRepository();
  const [overview, sites, departments] = await Promise.all([
    workforce.readOverview(workforcePrincipal),
    organization.list(tenantReadPrincipal, "site"),
    organization.list(tenantReadPrincipal, "department")
  ]);

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company workforce</p>
          <h1>Worker invitations and Company codes</h1>
          <p className="page-intro">
            Invite Workers, process bulk CSV rows, create bounded Company registration codes, and request consent-based links to existing permanent Worker-IDs. Company defaults never transfer ownership of a Worker&apos;s HSE Verify identity.
          </p>
        </div>
      </header>
      <CompanyWorkforceInvitationsWorkspace
        overview={overview}
        sites={sites}
        departments={departments}
      />
    </div>
  );
}
