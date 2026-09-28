import { submitAccommodationAction } from "@/app/worker/(portal)/privacy/actions";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";

export default async function WorkerAccessibilityPage(): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization("worker");
  const privacy = await new PrivacyOperationsService().listWorkerPrivacy(
    principal.tenantMembership?.tenantId ?? null,
    principal.accountId,
    principal.accountId
  );
  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div>
        <p className="eyebrow">Worker delivery adjustments</p>
        <h1>Accessibility & accommodations</h1>
        <p className="page-intro">
          Request an adjustment to assessment or interview delivery. Approved accommodations change delivery conditions, not competency standards.
        </p>
      </div></header>
      <section className="surface-card">
        <h2>Request an accommodation</h2>
        <form action={submitAccommodationAction} className="form-grid" aria-label="accessibility accommodation form">
          <label>
            Accommodation request
            <input
              name="type"
              required
              minLength={3}
              maxLength={240}
              aria-label="Accommodation request"
              placeholder="Example: extra reading time due to an approved accessibility need"
            />
          </label>
          <button className="button button-primary" type="submit">Submit accommodation</button>
        </form>
        <p className="muted-copy">
          Details are restricted to staff who need them for delivery. A request does not automatically lower pass marks or competency requirements.
        </p>
      </section>
      <section className="surface-card">
        <h2>Your accommodation requests</h2>
        {privacy.accommodations.length === 0 ? (
          <p>No accommodation requests yet.</p>
        ) : (
          <div className="record-list">
            {privacy.accommodations.map((request) => (
              <article className="record-row" key={request.accommodation_id}>
                <div>
                  <h3>{request.accommodation_type}</h3>
                  <p>Status: {request.status}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
