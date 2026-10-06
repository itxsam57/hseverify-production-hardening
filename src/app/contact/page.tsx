import { randomBytes } from "node:crypto";

import Link from "next/link";

import { PublicInquiryForm } from "@/components/public-inquiry/public-inquiry-form";

import { PublicConcernForm } from "@/components/public-verification/public-concern-form";

function queryValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function validPublicReference(value: string): boolean {
  return value.length >= 32 && value.length <= 2048 && /^[A-Za-z0-9_.-]+$/.test(value);
}

function concernNonce(): string {
  return `concern_nonce_${randomBytes(18).toString("base64url")}`;
}

export default async function ContactPage({
  searchParams
}: {
  searchParams: Promise<{
    type?: string | string[];
    reference?: string | string[];
  }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const type = queryValue(params.type);
  const reference = queryValue(params.reference);
  const credentialConcern = type === "credential-concern";
  const usableReference = credentialConcern && validPublicReference(reference);

  if (!credentialConcern) {
    const demo=type==="demo";
    return <main className="public-verification-page">
      <Link className="brand-mark" href="/">HSE Verify</Link>
      <section className="public-verification-card">
        <p className="eyebrow">{demo?"Request demo":"Contact"}</p>
        <h1>{demo?"Request a demonstration":"Contact HSE Verify"}</h1>
        <PublicInquiryForm kind={demo?"demo":"contact"} submissionNonce={randomBytes(24).toString("base64url")}/>
        <p><Link href={demo?"/contact":"/contact?type=demo"}>{demo?"General contact":"Request a demo"}</Link></p>
        <p>For a credential concern, <Link href="/verify">verify the identifier first</Link>.</p>
      </section>
    </main>;
  }

  return (
    <main className="public-verification-page">
      <Link className="brand-mark" href="/">
        <span className="brand-symbol" aria-hidden="true">HV</span>
        <span>HSE Verify</span>
      </Link>

      <section className="public-verification-card">
        <p className="eyebrow">credential-concern</p>
        <h1>Report a credential concern</h1>
        {usableReference ? (
          <>
            <p className="muted-copy">
              Report a possible mismatch, copied result, status issue or other concern about the public verification you just checked. The reference below is an opaque verification capability; private Worker and evidence identifiers are not placed in this form.
            </p>
            <PublicConcernForm
              publicToken={reference}
              idempotencyNonce={concernNonce()}
            />
          </>
        ) : (
          <>
            <p className="muted-copy">
              The public verification reference is missing, invalid or no longer available. Verify the identifier again before reporting a concern.
            </p>
            <Link className="button button-secondary" href="/verify">
              Return to verification
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
