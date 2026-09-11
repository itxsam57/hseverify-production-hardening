import Link from "next/link";

import type { AuthenticatedSession } from "@/lib/auth/auth-session-service";
import type { AuthRole } from "@/lib/auth/auth-domain";

const ROLE_LABELS: Record<AuthRole, string> = {
  worker: "Worker",
  company: "Company",
  assessor: "Assessor",
  verifier: "Verifier",
  admin: "Administrator",
  root: "Root administrator"
};

const ROLE_BOUNDARIES: Record<Exclude<AuthRole, "worker">, string[]> = {
  company: [
    "Company assurance and Worker-management features will be added only through Company-scoped authorization.",
    "This session cannot enter assessor, verifier, administrator or root routes.",
    "Company staff provisioning remains separate from the Worker list."
  ],
  assessor: [
    "Only assessor assignments and evidence explicitly allocated to this account may be opened.",
    "Verifier decisions and administrator controls are outside this portal.",
    "Live assessment and interview work arrives in later accepted bricks."
  ],
  verifier: [
    "Only independent verification tasks allocated to this account may be opened.",
    "Assessor notes and Company tenancy remain isolated unless a later permission explicitly projects them.",
    "Administrative controls are outside this portal."
  ],
  admin: [
    "Platform administration is available without root-only authority.",
    "Root accounts, root-only settings and root sessions cannot be accessed here.",
    "Staff invitations are limited to Company, assessor and verifier roles."
  ],
  root: [
    "Root authority is isolated from every operational portal.",
    "Root sessions require password plus enrolled authenticator verification.",
    "All staff roles can be invited from the root staff-provisioning workspace."
  ]
};

export function RoleDashboard({
  session
}: {
  session: AuthenticatedSession;
}): React.JSX.Element {
  const label = ROLE_LABELS[session.role];
  if (session.role === "worker") {
    return (
      <div className="dashboard-page">
        <h1>Worker account authenticated</h1>
        <p>Continue to the Worker Dashboard for the accepted Worker experience.</p>
        <Link className="button button-primary" href="/worker/dashboard">
          Open Worker Dashboard
        </Link>
      </div>
    );
  }
  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">{label} Portal</p>
          <h1>Welcome, {session.displayName}</h1>
          <p className="page-intro">
            Authentication, MFA, session revocation and portal isolation are active. Domain workspaces remain behind their accepted brick gates.
          </p>
        </div>
        {session.role === "verifier" ? (
          <Link className="button button-primary" href="/verifier/reviews">
            Open evidence review queue
          </Link>
        ) : null}
      </header>

      <section className="metric-grid" aria-label={`${label} authentication status`}>
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

      <section className="dashboard-section" aria-labelledby="portal-boundary-heading">
        <p className="section-kicker">Security boundary</p>
        <h2 id="portal-boundary-heading">What this portal permits</h2>
        <ul>
          {ROLE_BOUNDARIES[session.role].map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
        </ul>
        <Link className="button button-secondary" href="/account/sessions">
          Review active sessions
        </Link>
      </section>
    </div>
  );
}
