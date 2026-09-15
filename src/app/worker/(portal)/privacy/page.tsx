import { submitAccommodationAction, submitPrivacyRequestAction } from "./actions";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";

export default async function WorkerPrivacyPage() {
  const principal = await requirePortalAuthorization("worker");
  const privacy = await new PrivacyOperationsService().listWorkerPrivacy(principal.accountId);
  return (
    <div className="dashboard-page">
      <h1>Privacy requests</h1>
      <p>Request access, correction, export or deletion of your personal information.</p>
      <form action={submitPrivacyRequestAction}>
        <label>
          Request type
          <select name="type" defaultValue="access">
            <option value="access">Access</option>
            <option value="correction">Correction</option>
            <option value="export">Export</option>
            <option value="deletion">Deletion</option>
          </select>
        </label>
        <button type="submit">Submit privacy request</button>
      </form>
      <h2>Accessibility accommodation</h2>
      <form action={submitAccommodationAction}>
        <label>
          Accommodation request
          <input name="type" required />
        </label>
        <button type="submit">Submit accommodation</button>
      </form>
      <p>Requests are stored under your worker account and processed through the privacy operations workflow.</p>
      <section>
        <h2>Your requests</h2>
        {privacy.requests.length === 0 ? <p>No privacy requests yet.</p> : privacy.requests.map((request: { request_id: string; request_type: string; status: string }) => (
          <p key={request.request_id}>{request.request_type}: {request.status}</p>
        ))}
      </section>
      <section>
        <h2>Your accommodations</h2>
        {privacy.accommodations.length === 0 ? <p>No accommodation requests yet.</p> : privacy.accommodations.map((request: { accommodation_id: string; accommodation_type: string; status: string }) => (
          <p key={request.accommodation_id}>{request.accommodation_type}: {request.status}</p>
        ))}
      </section>
    </div>
  );
}
