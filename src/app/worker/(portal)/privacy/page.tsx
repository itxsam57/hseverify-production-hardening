import {
  submitAccommodationAction,
  submitPrivacyRequestAction,
  withdrawConsentAction
} from "./actions";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { ConsentRecordService } from "@/lib/privacy/consent-record-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";

export const dynamic = "force-dynamic";

export default async function WorkerPrivacyPage(): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization("worker");
  const service = new PrivacyOperationsService();
  const [privacy, currentConsents, consentHistory] = await Promise.all([
    service.listWorkerPrivacy(
      principal.tenantMembership?.tenantId ?? null,
      principal.accountId,
      principal.accountId
    ),
    new ConsentRecordService().listCurrentWorker(principal.accountId),
    new ConsentRecordService().listWorkerHistory(principal.accountId)
  ]);

  return (
    <div className="dashboard-page page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Worker privacy</p>
          <h1>Privacy, consent & data rights</h1>
          <p>Requests and consent history stay attached to your Worker account and preserve audit history.</p>
        </div>
      </div>

      <section className="panel page-section content-stack">
        <h2>Privacy request</h2>
        <form action={submitPrivacyRequestAction} className="form-grid" aria-label="privacy request form">
          <label>
            Request type
            <select name="type" defaultValue="access" aria-label="Privacy request type">
              <option value="access">Access</option>
              <option value="correction">Correction</option>
              <option value="restriction">Restriction</option>
              <option value="consent_withdrawal">Consent withdrawal</option>
              <option value="share_link_revocation">Share-link revocation</option>
              <option value="retention_inquiry">Retention inquiry</option>
              <option value="export">Export</option>
              <option value="deletion">Deletion where legally permissible</option>
            </select>
          </label>
          <button type="submit">Submit privacy request</button>
        </form>
      </section>

      <section className="panel page-section content-stack">
        <h2>Accessibility accommodation</h2>
        <form action={submitAccommodationAction} className="form-grid" aria-label="accessibility accommodation form">
          <label>
            Accommodation request
            <input name="type" required minLength={3} maxLength={240} aria-label="Accommodation request" />
          </label>
          <button type="submit">Submit accommodation</button>
        </form>
      </section>

      <section className="page-section content-stack">
        <h2>Current consent state</h2>
        {currentConsents.length === 0 ? <p>No consent records yet.</p> : currentConsents.map((consent) => (
          <article className="panel content-stack" key={consent.consentId}>
            <div>
              <strong>{consent.consentType.replaceAll("_", " ")}</strong>
              <p>{consent.purpose}</p>
              <p>Status: {consent.action} · Version {consent.version}</p>
              {consent.caseId ? <p>Case: {consent.caseId}</p> : null}
            </div>
            {consent.action === "GRANTED" && consent.withdrawalRule === "FUTURE_PROCESSING_ONLY" ? (
              <form action={withdrawConsentAction} className="form-grid">
                <input type="hidden" name="consentId" value={consent.consentId} />
                <label>
                  Withdrawal reason
                  <input name="reason" required minLength={5} maxLength={1000} />
                </label>
                <button type="submit">Withdraw future processing consent</button>
              </form>
            ) : null}
            {consent.withdrawalRule === "NOT_WITHDRAWABLE_WHILE_REQUIRED" && consent.action === "GRANTED" ? (
              <p className="muted-copy">This consent is tied to an active required workflow. Its historical evidence is retained.</p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Your privacy requests</h2>
        {privacy.requests.length === 0 ? <p>No privacy requests yet.</p> : privacy.requests.map((request) => (
          <article className="record-row" key={request.request_id}>
            <p>{request.request_type.replaceAll("_", " ")}: {request.status}</p>
            {request.review_reason ? <p>Review outcome: {request.review_reason}</p> : null}
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Your accommodations</h2>
        {privacy.accommodations.length === 0 ? <p>No accommodation requests yet.</p> : privacy.accommodations.map((request) => (
          <article className="record-row" key={request.accommodation_id}>
            <div>
              <strong>{request.accommodation_type}</strong>
              <p>Status: {request.status}</p>
              {request.review_reason ? <p>Review outcome: {request.review_reason}</p> : null}
              {request.case_id ? <p>Applied to case: {request.case_id}</p> : null}
            </div>
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Consent history</h2>
        {consentHistory.length === 0 ? <p>No consent history yet.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Type</th><th>Action</th><th>Version</th><th>Case</th><th>Recorded</th></tr></thead>
              <tbody>
                {consentHistory.map((consent) => (
                  <tr key={consent.consentId + ":" + consent.version}>
                    <td>{consent.consentType.replaceAll("_", " ")}</td>
                    <td>{consent.action}</td>
                    <td>{consent.version}</td>
                    <td>{consent.caseId ?? "—"}</td>
                    <td>{consent.recordedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
