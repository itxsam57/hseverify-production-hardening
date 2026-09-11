import Link from "next/link";

import { RecoveryRequestForm } from "@/app/auth/recover/recovery-forms";
import { BrandMark } from "@/components/brand-mark";
import { isAuthRole, type AuthRole } from "@/lib/auth/auth-domain";

export default async function RecoveryPage({
  searchParams
}: {
  searchParams: Promise<{ portal?: string }>;
}): Promise<React.JSX.Element> {
  const { portal } = await searchParams;
  const role: AuthRole = isAuthRole(portal) ? portal : "worker";
  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="recovery-heading">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Account recovery</p>
          <h1 id="recovery-heading">Reset access without weakening portal isolation.</h1>
          <p>
            Recovery uses an expiring one-time email code. A successful reset revokes every active session for the account.
          </p>
        </div>
        <p className="auth-security-note">
          The response is deliberately generic and does not confirm whether an account exists.
        </p>
      </section>
      <section className="auth-card-panel" aria-label="Password recovery">
        <div className="auth-card">
          <p className="eyebrow">{role} portal</p>
          <h2>Start password recovery</h2>
          <p className="muted-copy">
            Enter the email used for this exact portal role.
          </p>
          <RecoveryRequestForm role={role} />
          <div className="auth-footer-links">
            <Link href={`/${role}/login`}>Return to sign in</Link>
            <span aria-hidden="true"> · </span>
            <Link href="/">Exit to public website</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
