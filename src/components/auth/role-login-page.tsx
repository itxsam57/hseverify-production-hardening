import Link from "next/link";

import type { RoleLoginActionState } from "@/app/auth/actions";
import { BrandMark } from "@/components/brand-mark";
import { RoleLoginForm } from "@/components/auth/role-login-form";
import {
  roleRequiresMfa,
  type AuthRole
} from "@/lib/auth/auth-domain";
import { safeRoleLoginReturnPath } from "@/lib/auth/auth-login-return";
import { readAuthenticatedSession } from "@/lib/auth/auth-session-service";

type RoleLoginAction = (
  previousState: RoleLoginActionState,
  formData: FormData
) => Promise<RoleLoginActionState>;

const ROLE_LABELS: Record<AuthRole, string> = {
  worker: "Worker",
  company: "Company",
  assessor: "Assessor",
  verifier: "Verifier",
  admin: "Administrator",
  root: "Root administrator"
};

const ROLE_DESCRIPTIONS: Record<AuthRole, string> = {
  worker: "Access your profile, evidence, assessments, assurance activity and credentials.",
  company: "Manage Company verification and, once verified, authorized workforce assurance operations.",
  assessor: "Complete assigned assessments and structured interviews within your assessor scope.",
  verifier: "Review evidence and assurance cases independently within your verifier scope.",
  admin: "Operate platform administration without root-only authority.",
  root: "Use the isolated root portal for the highest-sensitivity platform controls."
};

export async function RoleLoginPage({
  role,
  action,
  reason,
  returnTo
}: {
  role: AuthRole;
  action: RoleLoginAction;
  reason?: string;
  returnTo?: string;
}): Promise<React.JSX.Element> {
  const session = await readAuthenticatedSession();
  const label = ROLE_LABELS[role];
  const safeReturnTo = safeRoleLoginReturnPath(role, returnTo);

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby={`${role}-login-heading`}>
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">{label} Portal</p>
          <h1 id={`${role}-login-heading`}>Sign in to the isolated {label} Portal.</h1>
          <p>{ROLE_DESCRIPTIONS[role]}</p>
        </div>
        <p className="auth-security-note">
          This login creates one database-backed session fixed to the {label} role. Accessing another portal requires a full sign-out and separate login.
        </p>
      </section>

      <section className="auth-card-panel" aria-label={`${label} sign in`}>
        <div className="auth-card">
          <p className="eyebrow">Secure access</p>
          <h2>{label} sign in</h2>
          <p className="muted-copy">
            {roleRequiresMfa(role)
              ? "Password and authenticator verification are both required."
              : "Use the verified Worker account credentials created during registration."}
          </p>

          {reason === "signed-out" ? (
            <div className="form-alert form-alert-success" role="status">
              You have been signed out safely.
            </div>
          ) : null}
          {reason === "session-required" ? (
            <div className="form-alert" role="status">
              Sign in to continue to this portal.
            </div>
          ) : null}
          {reason === "enrollment-complete" ? (
            <div className="form-alert form-alert-success" role="status">
              Enrollment complete. Your password and authenticator are active. Sign in to continue to the {label} Portal.
            </div>
          ) : null}
          {reason === "password-reset" ? (
            <div className="form-alert form-alert-success" role="status">
              Password reset complete. Sign in using the new password.
            </div>
          ) : null}
          {role === "company" && reason === "registration-complete" ? (
            <div className="form-alert form-alert-success" role="status">
              Company account security is active. Sign in to continue the pending Company verification application.
            </div>
          ) : null}

          {session ? (
            <div className="existing-session-card">
              {session.role === role ? (
                <>
                  <p>You already have an active {label} Portal session.</p>
                  <Link
                    className="button button-primary button-full"
                    href={safeReturnTo}
                  >
                    Continue to {safeReturnTo.includes("company-access") ? "Company access" : "dashboard"}
                  </Link>
                </>
              ) : (
                <>
                  <p>
                    An isolated {ROLE_LABELS[session.role]} Portal session is active. Sign out there before entering another portal.
                  </p>
                  <Link
                    className="button button-secondary button-full"
                    href={safeRoleLoginReturnPath(session.role, null)}
                  >
                    Return to active portal
                  </Link>
                </>
              )}
            </div>
          ) : (
            <RoleLoginForm
              action={action}
              requiresMfa={roleRequiresMfa(role)}
              role={role}
              returnTo={safeReturnTo}
            />
          )}

          <div className="auth-footer-links">
            {role === "worker" ? (
              <Link href="/worker/register">Create a Worker account</Link>
            ) : role === "company" ? (
              <Link href="/company/register">Register a Company</Link>
            ) : (
              <span>Staff accounts are invitation-only.</span>
            )}
            <span aria-hidden="true"> · </span>
            <Link href="/">Exit to public website</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
