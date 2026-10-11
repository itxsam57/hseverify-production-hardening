import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { CredentialAppealsRepository } from "@/lib/credential/credential-appeals-repository";
import { reviewCredentialAppealAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminCredentialAppealsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const params = await searchParams;
  const appeals = await new CredentialAppealsRepository().listAll();
  const message = params.status === "updated" ? "Appeal review recorded." : null;
  const error =
    params.error === "status"
      ? "Select a valid appeal review status."
      : params.error === "reason"
        ? "A reasoned review outcome of at least 10 characters is required."
        : params.error === "action"
          ? "The selected credential/Living Record action is invalid for this review status."
          : params.error === "independence"
            ? "This appeal requires an independent authorized reviewer. No changes were saved."
          : params.error === "renewal"
            ? "Renewal requires an eligible original case, an authenticated issuance and a current policy with configured validity. No changes were saved."
          : params.error === "missing"
            ? "The appeal no longer exists."
            : null;

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Credential operations</p>
          <h1>Credential appeals</h1>
          <p>
            Review Worker appeals independently. Every transition, reviewer, reason and resulting
            credential/Living Record action is retained in the appeal history.
          </p>
        </div>
      </div>

      {message ? <p className="status-banner status-success" role="status">{message}</p> : null}
      {error ? <p className="status-banner status-error" role="alert">{error}</p> : null}

      {appeals.length === 0 ? (
        <div className="empty-state">
          <h2>No credential appeals</h2>
          <p>Worker appeals will appear here.</p>
        </div>
      ) : (
        <div className="content-stack">
          {appeals.map((appeal) => (
            <article id={appeal.appealId} className="panel content-stack" key={appeal.appealId}>
              <div>
                <h2>{appeal.credentialId}</h2>
                <p>Appeal: {appeal.appealId}</p>
                <p>Worker: {appeal.workerId}</p>
                <p>Status: {appeal.status.replaceAll("_", " ")} · Version {appeal.version}</p>
                <p>Grounds: {appeal.reason}</p>
                <p>Evidence: {appeal.evidence.length ? appeal.evidence.join(", ") : "None selected"}</p>
                {appeal.reviewerAccountId ? <p>Reviewer: {appeal.reviewerAccountId}</p> : null}
                {appeal.reviewReason ? <p>Latest review reason: {appeal.reviewReason}</p> : null}
                {appeal.outcomeAction ? <p>Outcome action: {appeal.outcomeAction.replaceAll("_", " ")}</p> : null}
              </div>

              {appeal.status === "submitted" || appeal.status === "under_review" ? (
                <form action={reviewCredentialAppealAction} className="form-grid" aria-label={"Review " + appeal.appealId}>
                  <input type="hidden" name="appealId" value={appeal.appealId} />
                  <label>
                    Review status
                    <select name="status" defaultValue={appeal.status === "submitted" ? "under_review" : "accepted"}>
                      <option value="under_review">Under review</option>
                      <option value="accepted">Accepted</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </label>
                  <label>
                    Accepted-outcome action
                    <select name="outcomeAction" defaultValue="none">
                      <option value="none">No credential status change</option>
                      <option value="reassessment">Require reassessment in Living Record</option>
                      <option value="renew">Renew credential</option>
                      <option value="suspend">Suspend credential</option>
                      <option value="revoke">Revoke credential</option>
                    </select>
                  </label>
                  <label>
                    Reasoned review outcome
                    <textarea name="reason" minLength={10} maxLength={4000} rows={5} required />
                  </label>
                  <button type="submit">Record appeal review</button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}