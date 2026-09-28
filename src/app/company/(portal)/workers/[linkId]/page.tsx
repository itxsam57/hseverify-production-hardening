import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getCompanyWorkforceDirectoryService } from "@/lib/company/company-workforce-directory-service";

export default async function CompanyWorkerDetailPage({
  params
}: {
  params: Promise<{ linkId: string }>;
}): Promise<React.JSX.Element> {
  const { linkId } = await params;
  const principal = await requireCurrentTenantPermission("company.workforce.manage");
  const worker = await getCompanyWorkforceDirectoryService().find(principal, linkId);
  if (!worker) notFound();

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company-scoped Worker report</p>
          <h1>{worker.name}</h1>
          <p className="page-intro">
            This view contains only the company relationship and assurance state authorized for this tenant.
          </p>
        </div>
        <Link className="button button-secondary" href="/company/workers">Back to directory</Link>
      </header>
      <section className="surface-card">
        <dl className="detail-list">
          <div><dt>Worker ID</dt><dd>{worker.workerId ?? "Pending"}</dd></div>
          <div><dt>Email</dt><dd>{worker.email}</dd></div>
          <div><dt>Relationship</dt><dd>{worker.status.replaceAll("_", " ")}</dd></div>
          <div><dt>Site</dt><dd>{worker.site ?? "Not assigned"}</dd></div>
          <div><dt>Department</dt><dd>{worker.department ?? "Not assigned"}</dd></div>
          <div><dt>Assessment pre-assignment</dt><dd>{worker.assessmentReference ?? "None"}</dd></div>
          <div><dt>Latest assurance state</dt><dd>{worker.assuranceStatus ?? "No active case"}</dd></div>
          <div><dt>Next action</dt><dd>{worker.nextAction ?? "No action currently required"}</dd></div>
        </dl>
        {worker.workerId ? <Link href={`/verify/worker/${encodeURIComponent(worker.workerId)}`}>Open public verification</Link> : null}
      </section>
    </div>
  );
}
