import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RegistrationSandboxForm } from "@/app/worker/register/sandbox/sandbox-form";
import { BrandMark } from "@/components/brand-mark";
import { getServerEnvironment } from "@/lib/config/server-environment";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Registration sandbox inbox | HSE Verify"
};

export default function WorkerRegistrationSandboxPage(): React.JSX.Element {
  const environment = getServerEnvironment();
  if (!environment.authSandboxEnabled) {
    notFound();
  }

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="sandbox-intro-title">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Development sandbox</p>
          <h1 id="sandbox-intro-title">Open an encrypted test delivery.</h1>
          <p>
            This inbox simulates email and phone delivery while live providers remain disconnected. It is blocked outside development and test environments.
          </p>
        </div>
        <p className="auth-security-note">
          Codes are decrypted only after the sandbox access key is verified. The access key and plaintext code are not written to logs or browser storage.
        </p>
      </section>

      <section className="auth-card-panel" aria-labelledby="sandbox-card-title">
        <div className="auth-card">
          <p className="eyebrow">Test delivery</p>
          <h2 id="sandbox-card-title">Sandbox inbox</h2>
          <p className="muted-copy">
            Enter the exact registration destination and the local sandbox key to reveal only the latest delivery.
          </p>
          <RegistrationSandboxForm />
        </div>
      </section>
    </main>
  );
}
