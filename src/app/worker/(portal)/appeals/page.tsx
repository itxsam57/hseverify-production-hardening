import Link from "next/link";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { CredentialAppealsRepository } from "@/lib/credential/credential-appeals-repository";
import { CredentialIssuanceRepository } from "@/lib/credential/credential-issuance-repository";
import { getDatabaseClient } from "@/lib/database/database";
import { WorkerEvidenceService } from "@/lib/worker-evidence/worker-evidence-service";
import {
  submitCredentialAppealAction,
  withdrawCredentialAppealAction
} from "./actions";

export const dynamic = "force-dynamic";

export default async function WorkerAppealsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  const [principal, session, params] = await Promise.all([
    requirePortalAuthorization("worker"),
    requireWorkerSession(),
    searchParams
  ]);
  const [credentials, appeals, evidence] = await Promise.all([
    new CredentialIssuanceRepository().listByWorker(session.workerId),
    new CredentialAppealsRepository().listForWorker(session.workerId),
    new WorkerEvidenceService(getDatabaseClient()).listCurrent(principal)
  ]);

  const message =
    params.status === "submitted"
      ? "Appeal submitted for independent review."
      : params.status === "withdrawn"
        ? "Appeal withdrawn. Its history remains preserved."
        : null;
  const error =
    params.error === "reason"
      ? "Provide at least 10 characters explaining the appeal grounds."
      : params.error === "credential"
        ? "That credential is not owned by this Worker."
        : params.error === "evidence"
          ? "One or more evidence references are not owned by this Worker."
          : params.error === "open"
            ? "An appeal is already open for that credential."
            : params.error === "appeal"
              ? "That appeal is unavailable."
              : null;

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Worker</p>
          <h1>Credential appeals</h1>
          <p>
            Appeal an issued credential using your own retained evidence. The original credential,
            appeal history and independent review outcome remain auditable.
          </p>
        </div>
      </div>

      {message ? <p className="status-banner status-success" role="status">{message}</p> : null}
      {error ? <p className="status-banner status-error" role="alert">{error}</p> : null}

      <section className="panel content-stack" aria-labelledby="new-appeal-heading">
        <h2 id="new-appeal-heading">Start an appeal</h2>
        {credentials.length === 0 ? (
          <p>No issued credential is currently available to appeal.</p>
        ) : (
          <form action={submitCredentialAppealAction} className="form-grid">
            <label>
              Credential
              <select name="credentialId" required defaultValue="">
                <option value="" disabled>Select credential</option>
                {credentials.map((credential) => (
                  <option value={credential.credentialId} key={credential.credentialId}>
                    {credential.qualification} · {credential.status} · v{credential.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Appeal grounds
              <textarea
                name="reason"
                minLength={10}
                maxLength={4000}
                rows={6}
                required
                placeholder="Explain what decision or credential information should be reviewed and why."
              />
            </label>
            <fieldset>
              <legend>Supporting evidence from your retained records</legend>
              {evidence.length === 0 ? <p>No Worker evidence records are available.</p> : evidence.map((record) => (
                <label key={record.recordId}>
                  <input type="checkbox" name="evidenceRecordIds" value={record.recordId} />
                  {record.kind.replaceAll("_", " ")} · {record.currentVersion.status} · {record.recordId}
                </label>
              ))}
            </fieldset>
            <button type="submit">Submit credential appeal</button>
          </form>
        )}
      </section>

      <section className="content-stack" aria-labelledby="appeal-history-heading">
        <h2 id="appeal-history-heading">Appeal history</h2>
        {appeals.length === 0 ? <p>No credential appeals yet.</p> : appeals.map((appeal) => (
          <article id={appeal.appealId} className="panel content-stack" key={appeal.appealId}>
            <div>
              <strong>{appeal.credentialId}</strong>
              <p>Status: {appeal.status.replaceAll("_", " ")} · Version {appeal.version}</p>
              <p>Grounds: {appeal.reason}</p>
              <p>Evidence references: {appeal.evidence.length ? appeal.evidence.join(", ") : "None selected"}</p>
              {appeal.reviewReason ? <p>Review outcome: {appeal.reviewReason}</p> : null}
              {appeal.outcomeAction && appeal.outcomeAction !== "none" ? (
                <p>Credential/Living Record action: {appeal.outcomeAction.replaceAll("_", " ")}</p>
              ) : null}
              {appeal.status==="accepted" && appeal.outcomeAction==="reassessment" ? (
                <Link className="ds-button ds-button-primary" href={"/worker/assessment-applications?sourceAppealId="+encodeURIComponent(appeal.appealId)}>
                  Continue reassessment
                </Link>
              ) : null}
              {appeal.reviewedAt ? <p>Reviewed: {appeal.reviewedAt}</p> : null}
            </div>
            {appeal.status === "submitted" || appeal.status === "under_review" ? (
              <form action={withdrawCredentialAppealAction}>
                <input type="hidden" name="appealId" value={appeal.appealId} />
                <button type="submit">Withdraw appeal</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>
    </section>
  );
}