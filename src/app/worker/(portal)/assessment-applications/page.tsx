import Link from "next/link";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getWorkerAssessmentApplicationService } from "@/lib/assessment-catalogue/worker-assessment-application-service";
import {
  applyWorkerPayAction,
  confirmSandboxWorkerPaymentAction,
  requestCompanyFundingAction
} from "./actions";

export const dynamic = "force-dynamic";

export default async function WorkerAssessmentApplicationsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
  const service = await getWorkerAssessmentApplicationService();
  const [offerings, companies, applications, params] = await Promise.all([
    service.listOfferings(principal),
    service.listFundingCompanies(principal),
    service.listApplications(principal),
    searchParams
  ]);

  const statusMessage =
    params.status === "payment-required"
      ? "Application created. Complete the sandbox self-payment confirmation to fund the assessment."
      : params.status === "funding-requested"
        ? "Company funding request submitted."
        : params.status === "case-created"
          ? "Funding confirmed. The assessment case is ready."
          : null;

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Assessment applications</p>
          <h1>Apply and fund an assessment</h1>
          <p>
            Eligible Workers can self-fund an assessment in sandbox mode or request one assessment
            credit from an active linked Company. Live payment is not connected in sandbox mode.
          </p>
        </div>
      </div>

      {statusMessage ? <p className="status-banner status-success" role="status">{statusMessage}</p> : null}
      {params.error ? <p className="status-banner status-error" role="alert">{params.error}</p> : null}

      <section className="content-stack" aria-labelledby="eligible-applications-heading">
        <h2 id="eligible-applications-heading">Eligible assessments</h2>
        {offerings.length === 0 ? (
          <div className="empty-state">
            <h3>No eligible assessment applications</h3>
            <p>
              A verified identity, sufficient approved qualification evidence and unseen question
              capacity are required.
            </p>
          </div>
        ) : offerings.map((item) => (
          <article className="panel content-stack" key={item.catalogueVersionId}>
            <div>
              <p className="eyebrow">{item.catalogueReference}</p>
              <h3>{item.title}</h3>
              {item.description ? <p>{item.description}</p> : null}
              <p>
                Verified qualifications: {item.verifiedQualificationCount} / {item.minimumVerifiedQualifications} required
              </p>
              <p className="muted-copy">Effective policy: {item.policyReference}</p>
            </div>

            <div className="two-column-grid">
              <form action={applyWorkerPayAction} className="content-stack">
                <input type="hidden" name="catalogueVersionId" value={item.catalogueVersionId} />
                <h4>Pay myself</h4>
                <p className="muted-copy">
                  Sandbox funding only. No real card or money is charged until a production payment
                  provider is connected.
                </p>
                <button type="submit">Apply — worker pays</button>
              </form>

              <form action={requestCompanyFundingAction} className="content-stack">
                <input type="hidden" name="catalogueVersionId" value={item.catalogueVersionId} />
                <h4>Request Company funding</h4>
                {companies.length === 0 ? (
                  <p className="muted-copy">No active linked Company can fund this assessment.</p>
                ) : (
                  <>
                    <label>
                      Funding Company
                      <select name="companyFunding" required defaultValue="">
                        <option value="" disabled>Select Company</option>
                        {companies.map((company) => (
                          <option
                            key={company.workerLinkId}
                            value={company.tenantId + "|" + company.workerLinkId}
                          >
                            {company.companyName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">Request 1 assessment credit</button>
                  </>
                )}
              </form>
            </div>
          </article>
        ))}
      </section>

      <section className="content-stack" aria-labelledby="application-history-heading">
        <h2 id="application-history-heading">Application and funding history</h2>
        {applications.length === 0 ? (
          <p>No assessment applications yet.</p>
        ) : applications.map((item) => (
          <article className="panel content-stack" key={item.applicationId}>
            <div>
              <h3>{item.title}</h3>
              <p>Status: {item.status.replaceAll("_", " ")}</p>
              <p>Funding: {item.fundingMode === "WORKER_PAY" ? "Worker pays" : "Company request"}</p>
              {item.companyName ? <p>Company: {item.companyName}</p> : null}
              {item.sandboxPaymentReference ? (
                <p>Sandbox payment reference: <code>{item.sandboxPaymentReference}</code></p>
              ) : null}
              {item.fundingRequestId ? <p>Funding request: <code>{item.fundingRequestId}</code></p> : null}
              {item.assuranceCaseId ? <p>Assurance case: <code>{item.assuranceCaseId}</code></p> : null}
            </div>

            {item.status === "PAYMENT_REQUIRED" ? (
              <form action={confirmSandboxWorkerPaymentAction}>
                <input type="hidden" name="applicationId" value={item.applicationId} />
                <button type="submit">Confirm sandbox payment</button>
              </form>
            ) : null}
            {item.status === "CASE_CREATED" ? (
              <Link className="ds-button ds-button-primary" href="/worker/available-assessments">
                Continue to available assessments
              </Link>
            ) : null}
          </article>
        ))}
      </section>
    </section>
  );
}
