import { resolveTenantPermissions } from "@/lib/authorization/authorization-domain";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { CompanyTeamWorkspace } from "@/components/company/company-team-workspace";
import { getCompanyOrganizationRepository } from "@/lib/company/company-organization-repository";
import { getCompanyTeamService } from "@/lib/company/company-team-service";

export default async function CompanyTeamPage(): Promise<React.JSX.Element> {
  const teamPrincipal = await requireCurrentTenantPermission("company.members.read");
  const organizationPrincipal = await requireCurrentTenantPermission("company.tenant.read");
  const organization = getCompanyOrganizationRepository();
  const team = getCompanyTeamService();
  const [members, invitations, sites, departments] = await Promise.all([
    team.listMembers(teamPrincipal),
    team.listInvitations(teamPrincipal),
    organization.list(organizationPrincipal, "site"),
    organization.list(organizationPrincipal, "department")
  ]);
  const actorPermissions = [
    ...resolveTenantPermissions(
      teamPrincipal.tenantMembership.role,
      teamPrincipal.tenantMembership.overrides
    )
  ];

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company access</p>
          <h1>Company Team</h1>
          <p className="page-intro">
            Invite and manage Company staff separately from Workers. Tenant role,
            site/department scope and permissions stay server-bound, and every new
            member must complete the existing password and TOTP enrollment flow.
          </p>
        </div>
      </header>
      <CompanyTeamWorkspace
        members={members}
        invitations={invitations}
        sites={sites}
        departments={departments}
        actorMembershipId={teamPrincipal.tenantMembership.membershipId}
        actorRole={teamPrincipal.tenantMembership.role}
        actorPermissions={actorPermissions}
        canManage={actorPermissions.includes("company.members.manage")}
      />
    </div>
  );
}
