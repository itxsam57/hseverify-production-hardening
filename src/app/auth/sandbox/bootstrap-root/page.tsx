import { notFound } from "next/navigation";

import { RootBootstrapForm } from "@/app/auth/sandbox/bootstrap-root/bootstrap-form";
import { BrandMark } from "@/components/brand-mark";
import { getServerEnvironment } from "@/lib/config/server-environment";

export const dynamic = "force-dynamic";

export default function RootBootstrapPage(): React.JSX.Element {
  if (!getServerEnvironment().authSandboxEnabled) notFound();
  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="root-bootstrap-heading">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Development/test only</p>
          <h1 id="root-bootstrap-heading">Bootstrap the first root account.</h1>
          <p>
            This route disappears when the authentication sandbox is disabled and refuses to create another invitation after a root role exists.
          </p>
        </div>
      </section>
      <section className="auth-card-panel" aria-label="Root bootstrap">
        <div className="auth-card">
          <h2>Create the one-time invitation</h2>
          <RootBootstrapForm />
        </div>
      </section>
    </main>
  );
}
