import Link from "next/link";

import {
  beginCompanyVerificationReviewAction,
  decideCompanyVerificationAction
} from "./actions";
import { Alert } from "@/components/ui/feedback";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getCompanyVerificationReviewService } from "@/lib/company/company-verification-review-service";

const RESULT_MESSAGES: Readonly<Record<string, { tone: "success" | "warning" | "danger"; message: string }>> = Object.freeze({
  "review-started": {
    tone: "success",
    message: "Company verification review started. The submitted version is now locked in review."
  },
  "decision-recorded": {
    tone: "success",
    message: "Company verification decision recorded. The accepted history remains immutable."
  },
  conflict: {
    tone: "warning",
    message: "That Company verification changed in another request. The current queue has been reloaded."
  },
  denied: {
    tone: "danger",
    message: "Your current Administrator session cannot complete that Company verification action."
  },
  invalid: {
    tone: "danger",
    message: "The Company verification request was invalid and no change was made."
  }
});

function formatSubmittedAt(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Submission timestamp unavailable";
}

export default async function CompanyVerificationReviewPage({
  searchParams
}: {
  searchParams: Promise<{ result?: string }>;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.tenants.manage"
  });
  const queue = await (await getCompanyVerificationReviewService()).listForReview(principal);
  const { result } = await searchParams;
  const feedback = result ? RESULT_MESSAGES[result] : undefined;

  return (
    <div className="page-stack">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Tenant assurance</p>
          <h1>Company verification review</h1>
          <p className="page-intro">
            Review the exact submitted Company version and its scanned private evidence before recording a server-authorized decision. Verified decisions activate the pending tenant in the same transaction.
          </p>
        </div>
        <span className="status-pill">{queue.length} open</span>
      </header>

      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      {queue.length === 0 ? (
        <Alert tone="neutral">No submitted or in-review Company verification cases are waiting.</Alert>
      ) : (
        <section className="content-stack" aria-label="Company verification queue">
          {queue.map((item) => (
            <article className="panel page-section" key={item.caseId} data-case-id={item.caseId}>
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">{item.caseStatus.replaceAll("_", " ")}</p>
                  <h2>{item.legalName || "Unnamed Company"}</h2>
                  <p className="muted-copy">
                    {item.tradingName || "No trading name"} · version {item.versionNumber} · submitted {formatSubmittedAt(item.submittedAt)}
                  </p>
                </div>
                <span className="status-pill">{item.caseStatus}</span>
              </div>

              <dl className="detail-grid">
                <div><dt>Registration</dt><dd>{item.registrationNumber || "—"}</dd></div>
                <div><dt>Country</dt><dd>{item.country || "—"}</dd></div>
                <div><dt>Industry</dt><dd>{item.industry || "—"}</dd></div>
                <div><dt>Company size</dt><dd>{item.companySize || "—"}</dd></div>
                <div><dt>Representative</dt><dd>{item.authorizedRepresentative || "—"}</dd></div>
                <div><dt>Business email</dt><dd>{item.businessEmail || "—"}</dd></div>
                <div><dt>Business phone</dt><dd>{item.businessPhone || "—"}</dd></div>
                <div><dt>Website</dt><dd>{item.website ? <a href={item.website} rel="noreferrer" target="_blank">Open submitted website</a> : "—"}</dd></div>
              </dl>

              <section aria-labelledby={`${item.caseId}-evidence`}>
                <h3 id={`${item.caseId}-evidence`}>Submitted evidence</h3>
                {item.evidence.length === 0 ? (
                  <Alert tone="danger">No available evidence is attached to this submitted version. Do not approve it.</Alert>
                ) : (
                  <ul className="content-stack">
                    {item.evidence.map((evidence) => (
                      <li key={evidence.fileId}>
                        <strong>{evidence.evidenceLabel}</strong>{" "}
                        <span className="muted-copy">{evidence.displayFilename} · {evidence.detectedMime ?? "unknown type"} · {evidence.byteSize ?? "?"} bytes</span>{" "}
                        <Link
                          href={`/admin/company-verifications/${item.caseId}/evidence/${evidence.fileId}`}
                          target="_blank"
                        >
                          Preview evidence
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {item.caseStatus === "submitted" ? (
                <form action={beginCompanyVerificationReviewAction}>
                  <input type="hidden" name="caseId" value={item.caseId} />
                  <button type="submit">Begin review</button>
                </form>
              ) : (
                <div className="content-stack">
                  <Alert tone="warning">
                    Record a decision only after checking the submitted details and every available evidence item. Decisions are terminal for this submitted version.
                  </Alert>
                  <div className="button-row" role="group" aria-label={`Decide ${item.legalName || "Company"} verification`}>
                    <form action={decideCompanyVerificationAction}>
                      <input type="hidden" name="caseId" value={item.caseId} />
                      <input type="hidden" name="outcome" value="verified" />
                      <button type="submit">Verify Company</button>
                    </form>
                    <form action={decideCompanyVerificationAction}>
                      <input type="hidden" name="caseId" value={item.caseId} />
                      <input type="hidden" name="outcome" value="changes_requested" />
                      <button type="submit">Request changes</button>
                    </form>
                    <form action={decideCompanyVerificationAction}>
                      <input type="hidden" name="caseId" value={item.caseId} />
                      <input type="hidden" name="outcome" value="rejected" />
                      <button className="button-danger" type="submit">Reject</button>
                    </form>
                  </div>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
