import { WorkerCompanyAccessWorkspace } from "@/components/worker/worker-company-access-workspace";
import { Alert } from "@/components/ui/feedback";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getCompanyWorkforceWorkerReadRepository } from "@/lib/company/company-workforce-worker-read-repository";

export default async function WorkerCompanyAccessPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization("worker");
  const links = await getCompanyWorkforceWorkerReadRepository().listLinks(principal);
  const { status } = await searchParams;

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Worker Company access</p>
          <h1>Company links</h1>
          <p className="page-intro">
            Redeem a Company registration code, review pending Company link requests, and see active Company associations without transferring ownership of your Worker identity or permanent Worker-ID.
          </p>
        </div>
      </header>

      {status === "linked" ? (
        <Alert tone="success">Company access was linked successfully.</Alert>
      ) : status === "handoff-unavailable" ? (
        <Alert tone="warning">
          The Company invitation or registration handoff is no longer available. Use a current invitation or Company registration code instead.
        </Alert>
      ) : null}

      <WorkerCompanyAccessWorkspace links={links} />
    </div>
  );
}
