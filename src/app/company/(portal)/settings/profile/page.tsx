import type { Metadata } from "next";

import { CompanyVerificationWorkspace } from "@/components/company/company-verification-workspace";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getCompanyVerificationService } from "@/lib/company/company-verification-service";

export const metadata: Metadata = {
  title: "Company profile and verification | HSE Verify"
};

export default async function CompanyVerificationProfilePage(): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization("company");
  const snapshot = await getCompanyVerificationService().loadOwn(principal);
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Company settings</p>
          <h1>Company profile and verification</h1>
          <p>
            Manage the versioned legal Company record and private verification evidence. Pending tenants can use this workflow without receiving normal tenant business permissions.
          </p>
        </div>
      </header>
      <CompanyVerificationWorkspace snapshot={snapshot} />
    </div>
  );
}
