import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { resolveTenantPermissions } from "@/lib/authorization/authorization-domain";
import { getCompanyOrganizationRepository } from "@/lib/company/company-organization-repository";
import { CompanyOrganizationWorkspace } from "@/components/company/company-organization-workspace";

export default async function CompanyOrganizationPage(): Promise<React.JSX.Element> {
  const principal = await requireCurrentTenantPermission("company.tenant.read");
  const repository = getCompanyOrganizationRepository();
  const [sites, departments] = await Promise.all([
    repository.list(principal, "site"),
    repository.list(principal, "department")
  ]);
  const permissions = resolveTenantPermissions(principal.tenantMembership.role, principal.tenantMembership.overrides);
  return <div className="dashboard-page"><header className="page-heading-row"><div><p className="eyebrow">Company organization</p><h1>Sites and Departments</h1><p className="page-intro">Manage the Company structure in one tenant-scoped interface. Archived units keep their history and cannot receive new assignments until restored.</p></div></header><CompanyOrganizationWorkspace sites={sites} departments={departments} canManage={permissions.has("company.settings.manage")} /></div>;
}
