import Link from "next/link";

import { requireRoleSession } from "@/lib/auth/auth-session-service";

export default async function CompanyDashboardPage(): Promise<React.JSX.Element> {
  const session = await requireRoleSession("company");

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company Portal</p>
          <h1>Welcome, {session.displayName}</h1>
          <p className="page-intro">
            Authentication, mandatory TOTP, role isolation and the trusted Company tenant boundary are active. Company verification controls when workforce and assurance operations become available; use Company profile to submit evidence and track the current verification state.
          </p>
        </div>
      </header>

      <section className="metric-grid" aria-label="Company authentication status">
        <article className="metric-card">
          <strong>Role fixed</strong>
          <p>{session.role}</p>
        </article>
        <article className="metric-card">
          <strong>Session expires</strong>
          <p>{new Date(session.expiresAt).toLocaleString()}</p>
        </article>
        <article className="metric-card">
          <strong>MFA</strong>
          <p>Required and verified at sign-in.</p>
        </article>
      </section>

      <section className="dashboard-section" aria-labelledby="verification-heading">
        <p className="section-kicker">Company verification</p>
        <h2 id="verification-heading">Complete and track the Company verification case</h2>
        <p>
          Company profile and verification remain available while the tenant is pending. Save the legal and business details, attach private evidence, submit the verification version, and return here after the platform decision is accepted.
        </p>
        <Link className="button button-primary" href="/company/settings/profile">
          Open Company verification
        </Link>
      </section>

      <section className="dashboard-section" aria-labelledby="tenant-demonstration-heading">
        <p className="section-kicker">M1.04 tenant isolation</p>
        <h2 id="tenant-demonstration-heading">Prove the current Company tenant boundary</h2>
        <p>
          Open the accepted tenant-scope demonstration to confirm reads and writes are derived from this server session and cannot be redirected to another Company by a browser-supplied tenant identifier.
        </p>
        <Link className="button button-secondary" href="/company/tenant-scope">
          Open tenant-scope demonstration
        </Link>
      </section>

      <section className="dashboard-section" aria-labelledby="company-boundary-heading">
        <p className="section-kicker">Security boundary</p>
        <h2 id="company-boundary-heading">What this portal permits</h2>
        <ul>
          <li>Only the Company tenant resolved by the server session may be used.</li>
          <li>This session cannot enter Worker, assessor, verifier, administrator or root workspaces.</li>
          <li>Company profile and verification are available while pending; sites, departments, Company Team, Worker linking and assurance operations remain server-gated until Company verification is accepted.</li>
        </ul>
        <Link className="button button-secondary" href="/account/sessions">
          Review active sessions
        </Link>
      </section>
    </div>
  );
}
