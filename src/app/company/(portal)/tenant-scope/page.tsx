import Link from "next/link";

import { TenantScopeDemonstration } from "@/components/company/tenant-scope-demonstration";
import { ensureLocalCompanyScopeOwnerBootstrap } from "@/lib/authorization/company-scope-owner-bootstrap";
import { loadCompanyScopeDemonstration } from "@/lib/authorization/tenant-scope-fixture-service";

export default async function CompanyTenantScopePage({
  searchParams
}: {
  searchParams: Promise<{ result?: string }>;
}): Promise<React.JSX.Element> {
  await ensureLocalCompanyScopeOwnerBootstrap();
  const workspace = await loadCompanyScopeDemonstration();
  const { result } = await searchParams;
  const deleteResult =
    result === "deleted" || result === "unchanged" ? result : undefined;

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company Portal · M1.04 security demonstration</p>
          <h1>Current Company tenant boundary</h1>
          <p className="page-intro">
            This protected surface proves that reads and mutations use only the Company tenant resolved from the authenticated session and active membership.
          </p>
        </div>
        <Link className="button button-secondary" href="/company/dashboard">
          Back to Company Dashboard
        </Link>
      </header>

      <TenantScopeDemonstration
        deleteResult={deleteResult}
        membershipRole={workspace.membershipRole}
        records={workspace.records}
        tenantReference={workspace.tenantReference}
      />
    </div>
  );
}
