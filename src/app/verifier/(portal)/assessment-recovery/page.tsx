import {
  claimAssessmentRecoveryAction,
  decideAssessmentRecoveryAction
} from "./actions";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getAssessmentRecoveryService } from "@/lib/assessment-attempt/assessment-recovery-service";

export default async function VerifierAssessmentRecoveryPage({
  searchParams
}: {
  searchParams: Promise<{ result?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const principal = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.read"
  });
  const queue = await getAssessmentRecoveryService().listQueue(principal);

  return (
    <section className="page-stack" aria-labelledby="assessment-recovery-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Verifier</p>
          <h1 id="assessment-recovery-heading">Assessment recovery</h1>
          <p>
            Review interrupted attempts without changing committed answers or deleting exposure history.
            A replacement creates a new unseen form only after the Worker passes a fresh precheck.
          </p>
        </div>
      </div>

      {params.result === "claimed" ? (
        <p className="status-banner status-success" role="status">Recovery review claimed.</p>
      ) : null}
      {params.result === "decided" ? (
        <p className="status-banner status-success" role="status">Recovery decision recorded.</p>
      ) : null}
      {params.error ? <p className="status-banner status-error" role="alert">{params.error}</p> : null}

      {queue.length === 0 ? (
        <section className="panel page-section">
          <h2>No recovery reviews</h2>
          <p className="muted-copy">No interrupted assessment currently requires your decision.</p>
        </section>
      ) : (
        <div className="content-stack">
          {queue.map((item) => (
            <article className="panel page-section content-stack" key={item.reviewId}>
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">{item.catalogueTitle}</p>
                  <h2>{item.workerName}</h2>
                </div>
                <span className="status-pill">{item.status.replaceAll("_", " ")}</span>
              </div>

              <dl>
                <div><dt>Assurance Case</dt><dd><code>{item.caseId}</code></dd></div>
                <div><dt>Attempt</dt><dd><code>{item.attemptId}</code></dd></div>
                <div><dt>Position</dt><dd>Question {item.currentPosition} of {item.questionCount}</dd></div>
                <div><dt>Interruption</dt><dd>{item.interruptionReason?.replaceAll("_", " ") ?? "Recorded interruption"}</dd></div>
                <div><dt>Worker request</dt><dd>{item.requestReason}</dd></div>
              </dl>

              {item.status === "QUEUED" ? (
                <form action={claimAssessmentRecoveryAction}>
                  <input type="hidden" name="reviewId" value={item.reviewId} />
                  <button className="button button-primary" type="submit">Claim recovery review</button>
                </form>
              ) : (
                <form action={decideAssessmentRecoveryAction} className="form-grid">
                  <input type="hidden" name="reviewId" value={item.reviewId} />
                  <label>
                    Decision
                    <select name="decision" defaultValue="ALLOW_RESUME">
                      <option value="ALLOW_RESUME">Allow original bound attempt to resume</option>
                      <option value="APPROVE_REPLACEMENT">Approve replacement assessment</option>
                    </select>
                  </label>
                  <label>
                    Decision reason
                    <textarea name="decisionReason" rows={5} minLength={10} maxLength={2000} required />
                  </label>
                  <p className="muted-copy">
                    Approving replacement permanently preserves the original form and exposed questions,
                    then authorizes one new unseen form after the Worker completes fresh prechecks.
                  </p>
                  <button className="button button-primary" type="submit">Record recovery decision</button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
