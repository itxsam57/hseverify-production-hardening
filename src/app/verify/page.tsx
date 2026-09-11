import Link from "next/link";

import { PublicVerificationForm } from "@/components/public-verification/public-verification-form";

export default function PublicVerificationPage(): React.JSX.Element {
  return (
    <main className="public-verification-page">
      <Link className="brand-mark" href="/">
        <span className="brand-symbol" aria-hidden="true">HV</span>
        <span>HSE Verify</span>
      </Link>

      <section className="public-verification-card" aria-labelledby="public-verification-title">
        <p className="eyebrow">Public verification</p>
        <h1 id="public-verification-title">Verify a worker or credential</h1>
        <p className="muted-copy">
          Enter an HSE Verify Worker ID or supported Credential ID, or scan an HSE Verify QR code. Results contain approved public information only.
        </p>
        <PublicVerificationForm />
        <p className="public-projection-note">
          Public verification never displays identity documents, contact details, home address, employment history, assessment answers, monitoring data or private review notes.
        </p>
      </section>
    </main>
  );
}