import Link from "next/link";

import { formatDateTime } from "@/lib/format";
import { getPublicVerificationRequestRuntime } from "@/lib/public-verification/public-verification-runtime";
import type { PublicVerificationResolvedResult } from "@/lib/public-verification/public-verification-service";

function publicStatusLabel(status: string): string {
  switch (status) {
    case "valid": return "Valid";
    case "expired": return "Expired";
    case "suspended": return "Suspended";
    case "revoked": return "Revoked";
    default: return "Not verified";
  }
}

function publicStatusClass(status: string): string {
  switch (status) {
    case "valid": return "status-positive";
    case "expired": return "status-warning";
    case "suspended":
    case "revoked": return "status-critical";
    default: return "status-neutral";
  }
}

function unavailableResult(): PublicVerificationResolvedResult {
  return { kind: "status", status: "temporarily_unavailable" };
}

export default async function PublicVerificationResultPage({
  params
}: {
  params: Promise<{ publicToken: string }>;
}): Promise<React.JSX.Element> {
  const { publicToken } = await params;
  let result: PublicVerificationResolvedResult;
  try {
    const { service, requestFingerprint } =
      await getPublicVerificationRequestRuntime();
    result = await service.resolvePublicVerificationCapability({
      publicToken,
      requestFingerprint
    });
  } catch {
    result = unavailableResult();
  }

  return (
    <main className="public-verification-page">
      <Link className="brand-mark" href="/">
        <span className="brand-symbol" aria-hidden="true">HV</span>
        <span>HSE Verify</span>
      </Link>

      <section className="public-verification-card">
        {result.kind === "projection" ? (
          <>
            <p className="eyebrow">Public verification result</p>
            <h1>{result.projection.displayName}</h1>
            <dl>
              <div>
                <dt>Public identifier</dt>
                <dd>{result.projection.publicIdentifier}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`status-badge ${publicStatusClass(result.projection.status)}`}>
                    {publicStatusLabel(result.projection.status)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Issued</dt>
                <dd>{result.projection.issuedAt ? formatDateTime(result.projection.issuedAt) : "Not applicable"}</dd>
              </div>
              {result.projection.expiresAt ? (
                <div>
                  <dt>Expires</dt>
                  <dd>{formatDateTime(result.projection.expiresAt)}</dd>
                </div>
              ) : null}
              {result.projection.competencyTitle ? (
                <div>
                  <dt>Competency</dt>
                  <dd>{result.projection.competencyTitle}</dd>
                </div>
              ) : null}
              {result.projection.restrictions.length > 0 ? (
                <div>
                  <dt>Restrictions</dt>
                  <dd>{result.projection.restrictions.join(", ")}</dd>
                </div>
              ) : null}
              <div>
                <dt>Verified at</dt>
                <dd>{formatDateTime(result.projection.verifiedAt)}</dd>
              </div>
            </dl>
            <p className="public-projection-note">
              This result contains only fields approved for public verification. The live status is checked again whenever this page is opened.
            </p>
            <div className="button-row">
              <Link className="button button-secondary" href="/verify">
                Verify another identifier
              </Link>
              <Link
                className="button button-secondary"
                href={`/contact?type=credential-concern&reference=${encodeURIComponent(publicToken)}`}
              >
                Report a credential concern
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Public verification</p>
            <h1>
              {result.status === "temporarily_unavailable"
                ? "Verification temporarily unavailable"
                : "Identifier not verified"}
            </h1>
            <p className="muted-copy">
              {result.status === "temporarily_unavailable"
                ? "Wait a few minutes and try again."
                : "The identifier is invalid, unsupported, unavailable for public verification, or could not be found."}
            </p>
            <Link className="button button-secondary" href="/verify">Try another identifier</Link>
          </>
        )}
      </section>
    </main>
  );
}
