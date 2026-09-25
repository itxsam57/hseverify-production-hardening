import Link from "next/link";

import type { AuthRole } from "@/lib/auth/auth-domain";
import type { AuthenticatedSession } from "@/lib/auth/auth-session-service";

const ROLE_LABELS: Record<AuthRole, string> = {
  worker: "Worker",
  company: "Company",
  assessor: "Assessor",
  verifier: "Verifier",
  admin: "Administrator",
  root: "Root administrator"
};

type WorkspaceLink = {
  readonly href: string;
  readonly title: string;
  readonly description: string;
};

const WORKSPACES: Record<Exclude<AuthRole, "worker" | "company">, readonly WorkspaceLink[]> = {
  verifier: [
    {
      href: "/verifier/reviews",
      title: "Evidence review queue",
      description: "Claim assigned evidence, declare conflicts, preview authorized files and finalize verification outcomes."
    },
    {
      href: "/verifier/reviews/scoring",
      title: "Written scoring",
      description: "Review written answers against the approved rubric, save criterion marks and finalize the review."
    },
    {
      href: "/verifier/notifications",
      title: "Notifications",
      description: "Open persisted workflow notifications and deep links to work that needs attention."
    }
  ],
  assessor: [
    {
      href: "/assessor/interviews",
      title: "Interview assignments",
      description: "Review assigned interviews, schedule them and open the structured interview console."
    },
    {
      href: "/assessor/notifications",
      title: "Notifications",
      description: "Open persisted interview and workflow notifications."
    }
  ],
  admin: [
    {
      href: "/admin/company-verifications",
      title: "Company verifications",
      description: "Review submitted Company details and evidence and record the platform verification decision."
    },
    {
      href: "/admin/frameworks",
      title: "Frameworks & policy",
      description: "Manage frameworks and publish immutable effective-policy versions."
    },
    {
      href: "/admin/question-bank",
      title: "Question Bank",
      description: "Create, revise, activate and retire versioned assessment questions."
    },
    {
      href: "/admin/assessment-blueprints",
      title: "Assessment blueprints",
      description: "Build and revise versioned assessment selector blueprints."
    },
    {
      href: "/admin/assessment-catalogue",
      title: "Assessment catalogue",
      description: "Publish assessment catalogue entries and eligibility settings."
    },
    {
      href: "/admin/decisions",
      title: "Decision Engine",
      description: "Inspect decision records, create reasoned decisions and record controlled overrides."
    },
    {
      href: "/admin/certifications",
      title: "Certifications",
      description: "Review credential and certification records and their current lifecycle state."
    },
    {
      href: "/admin/operations",
      title: "Operations & health",
      description: "Inspect provider health, operational readiness and production handover state."
    },
    {
      href: "/admin/staff",
      title: "Staff invitations",
      description: "Provision scoped staff accounts through one-time invitation and MFA enrollment."
    }
  ],
  root: [
    {
      href: "/root/staff",
      title: "Staff & access",
      description: "Provision platform staff roles through isolated one-time enrollment flows."
    },
    {
      href: "/root/notifications",
      title: "Notifications",
      description: "Review persisted root-level operational notifications."
    }
  ]
};

const ROLE_BOUNDARIES: Record<Exclude<AuthRole, "worker" | "company">, readonly string[]> = {
  assessor: [
    "Only interview work assigned to this assessor account is accessible.",
    "Verifier decisions and platform-administration controls remain outside this portal.",
    "Interview notes and recommendations are persisted under this assessor identity."
  ],
  verifier: [
    "Only queued work or tasks claimed by this verifier account are accessible.",
    "Conflicts requeue work and remove decision authority for that task.",
    "Company tenancy and administrator controls remain isolated from this portal."
  ],
  admin: [
    "Platform operations are available only within the permissions granted to this admin account.",
    "Root-only access management and recovery remain outside this portal.",
    "Material changes are server-authorized and auditable."
  ],
  root: [
    "Root authority is isolated from operational reviewer, assessor and Company workspaces.",
    "Root access is reserved for privileged staff provisioning and recovery controls.",
    "Routine case decisions should be completed in the dedicated operational portal."
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
        <p>Continue to the Worker Dashboard for your profile, evidence and assurance activity.</p>
        <Link className="button button-primary" href="/worker/dashboard">
          Open Worker Dashboard
        </Link>
      </div>
    );
  }

  if (session.role === "company") {
    return (
      <div className="dashboard-page">
        <h1>Company account authenticated</h1>
        <Link className="button button-primary" href="/company/dashboard">
          Open Company Dashboard
        </Link>
      </div>
    );
  }

  const workspaces = WORKSPACES[session.role];
  const boundaries = ROLE_BOUNDARIES[session.role];

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">{label} Portal</p>
          <h1>Welcome, {session.displayName}</h1>
          <p className="page-intro">
            Your live workspaces are below. Each action stays inside this role-bound session and is re-authorized by the server.
          </p>
        </div>
      </header>

      <section className="metric-grid" aria-label={`${label} session status`}>
        <article className="metric-card">
          <span className="metric-card-heading">Portal role</span>
          <strong>{label}</strong>
          <p>This browser session is fixed to {session.role}.</p>
        </article>
        <article className="metric-card">
          <span className="metric-card-heading">Session expiry</span>
          <strong>{new Date(session.expiresAt).toLocaleDateString()}</strong>
          <p>{new Date(session.expiresAt).toLocaleTimeString()}</p>
        </article>
        <article className="metric-card">
          <span className="metric-card-heading">Authentication</span>
          <strong>MFA verified</strong>
          <p>Protected actions remain bound to this authenticated account.</p>
        </article>
      </section>

      <section className="dashboard-section" aria-labelledby="workspace-heading">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">Workspaces</p>
            <h2 id="workspace-heading">Available operations</h2>
          </div>
        </div>
        <div className="workspace-grid">
          {workspaces.map((workspace) => (
            <article className="workspace-card" key={workspace.href}>
              <div>
                <h3>{workspace.title}</h3>
                <p>{workspace.description}</p>
              </div>
              <Link className="button button-secondary button-small" href={workspace.href}>
                Open
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="portal-boundary-heading">
        <p className="section-kicker">Security boundary</p>
        <h2 id="portal-boundary-heading">What this portal permits</h2>
        <ul className="boundary-list">
          {boundaries.map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
        </ul>
        <div className="button-row">
          <Link className="button button-secondary" href="/account/sessions">
            Review active sessions
          </Link>
          <Link className="button button-secondary" href={`/${session.role}/notifications`}>
            Open notifications
          </Link>
        </div>
      </section>
    </div>
  );
}
