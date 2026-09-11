import { notFound } from "next/navigation";

import { CompanyRegistrationSandboxForm } from "@/app/company/register/sandbox/sandbox-form";
import { BrandMark } from "@/components/brand-mark";
import { getServerEnvironment } from "@/lib/config/server-environment";

export default function CompanyRegistrationSandboxPage(): React.JSX.Element {
  const environment = getServerEnvironment();
  if (!environment.authSandboxEnabled) notFound();
  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="company-sandbox-title">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Authentication sandbox</p>
          <h1 id="company-sandbox-title">Open a synthetic Company registration email.</h1>
          <p>This tool exists only for local development and deterministic testing.</p>
        </div>
      </section>
      <section className="auth-card-panel" aria-label="Company registration sandbox inbox">
        <div className="auth-card">
          <p className="eyebrow">Encrypted local delivery</p>
          <h2>Company verification code</h2>
          <CompanyRegistrationSandboxForm />
        </div>
      </section>
    </main>
  );
}
