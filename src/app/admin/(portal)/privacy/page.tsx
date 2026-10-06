import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { ConsentRecordService } from "@/lib/privacy/consent-record-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";
import { reviewAccommodationAction, reviewPrivacyRequestAction } from "./actions";

export const dynamic = "force-dynamic";

function iso(value: string | Date | null): string {
  if (!value) return "—";
  return new Date(value).toISOString();
}

export default async function AdminPrivacyPage(): Promise<React.JSX.Element> {
  await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const privacy = new PrivacyOperationsService();
  const [requests, accommodations, consents] = await Promise.all([
    privacy.listRequestReviewQueue(),
    privacy.listAccommodationReviewQueue(),
    new ConsentRecordService().listRecent(100)
  ]);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Admin privacy operations</p>
          <h1>Consent & accommodation review</h1>
          <p>Need-to-know operational review. Competency standards are never reduced by an accommodation.</p>
        </div>
      </div>

      <section className="page-section content-stack">
        <h2>Privacy requests</h2>
        <p>Record intake and reasoned review. Fulfilment remains open until the requested operation is performed.</p>
        {requests.length === 0 ? <p>No privacy requests.</p> : requests.map((request) => (
          <article className="panel content-stack" key={request.request_id}>
            <p>Request type: {request.request_type.replaceAll("_", " ")}</p>
            <p>Worker: {request.worker_id}</p>
            <p>Status: {request.status}</p>
            <p>Requested: {iso(request.created_at)}</p>
            {typeof request.details?.sharePurpose === "string" ? <p>Share link: {request.details.sharePurpose}</p> : null}
            {typeof request.details?.consentPurpose === "string" ? <p>Consent: {request.details.consentPurpose}</p> : null}
            {request.review_reason ? <p>Review outcome: {request.review_reason}</p> : null}
            {["OPEN", "PROCESSING"].includes(request.status) ? (
              <form action={reviewPrivacyRequestAction} className="form-grid">
                <input type="hidden" name="requestId" value={request.request_id} />
                <input type="hidden" name="expectedStatus" value={request.status} />
                <label>Request decision
                  <select name="decision" defaultValue={request.status === "OPEN" ? "PROCESSING" : "REJECTED"} required>
                    {request.status === "OPEN" ? <option value="PROCESSING">Start processing</option> : null}
                    <option value="REJECTED">Reject request</option>
                    {request.request_type === "consent_withdrawal" && typeof request.details?.consentId === "string" && request.details.consentId.trim() ? (
                      <option value="COMPLETED">Withdraw requested optional sharing consent and complete</option>
                    ) : null}
                    {["access","export"].includes(request.request_type) ? (
                      <option value="COMPLETED">Prepare Worker data download and complete</option>
                    ) : null}
                    {request.request_type === "share_link_revocation" && typeof request.details?.shareLinkId === "string" && request.details.shareLinkId.trim() ? (
                      <option value="COMPLETED">Revoke requested share link and complete</option>
                    ) : null}
                  </select>
                </label>
                <label>Request review reason<textarea name="reason" minLength={10} maxLength={2000} required /></label>
                <button type="submit">Save privacy request decision</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Accommodation queue</h2>
        {accommodations.length === 0 ? <p>No accommodation requests.</p> : accommodations.map((item) => (
          <article className="panel content-stack" key={item.accommodation_id}>
            <div>
              <strong>{item.accommodation_type}</strong>
              <p>Worker: {item.worker_id}</p>
              <p>Status: {item.status}</p>
              <p>Requested: {iso(item.created_at)}</p>
              {item.review_reason ? <p>Review reason: {item.review_reason}</p> : null}
            </div>
            {item.status === "REQUESTED" ? (
              <form action={reviewAccommodationAction} className="form-grid">
                <input type="hidden" name="accommodationId" value={item.accommodation_id} />
                <label>
                  Decision
                  <select name="decision" defaultValue="APPROVED" required>
                    <option value="APPROVED">Approve</option>
                    <option value="DECLINED">Decline</option>
                  </select>
                </label>
                <label>
                  Assurance Case
                  <select name="caseId" defaultValue="">
                    <option value="">Select case for approval</option>
                    {item.cases.map((entry) => (
                      <option value={entry.case_id} key={entry.case_id}>
                        {entry.order_name ?? entry.order_reference ?? entry.case_id} — {entry.case_status}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Time multiplier
                  <input name="timeMultiplier" type="number" min="1" max="2" step="0.05" defaultValue="1" />
                </label>
                <label>
                  Extra break minutes
                  <input name="extraBreakMinutes" type="number" min="0" max="60" step="1" defaultValue="0" />
                </label>
                <label><input type="checkbox" name="screenReader" value="yes" /> Screen reader</label>
                <label><input type="checkbox" name="captions" value="yes" /> Captions</label>
                <label><input type="checkbox" name="interpreter" value="yes" /> Interpreter</label>
                <label><input type="checkbox" name="reducedMotion" value="yes" /> Reduced motion</label>
                <label>
                  Review reason
                  <textarea name="reason" minLength={10} maxLength={2000} required />
                </label>
                <button type="submit">Save accommodation decision</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      <section className="page-section content-stack">
        <h2>Recent consent history</h2>
        {consents.length === 0 ? <p>No consent records.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Worker</th><th>Type</th><th>Action</th><th>Case</th><th>Version</th><th>Recorded</th></tr></thead>
              <tbody>
                {consents.map((consent) => (
                  <tr key={consent.consentId + ":" + consent.version}>
                    <td>{consent.workerId}</td>
                    <td>{consent.consentType.replaceAll("_", " ")}</td>
                    <td>{consent.action}</td>
                    <td>{consent.caseId ?? "—"}</td>
                    <td>{consent.version}</td>
                    <td>{consent.recordedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
