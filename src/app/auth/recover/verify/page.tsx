import { RecoveryCompletionForm } from "@/app/auth/recover/recovery-forms";
import { BrandMark } from "@/components/brand-mark";
import { isAuthRole, type AuthRole } from "@/lib/auth/auth-domain";

export default async function RecoveryVerifyPage({
  searchParams
}: {
  searchParams: Promise<{ portal?: string }>;
}): Promise<React.JSX.Element> {
  const { portal } = await searchParams;
  const role: AuthRole = isAuthRole(portal) ? portal : "worker";
  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="recovery-verify-heading">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Verify and reset</p>
          <h1 id="recovery-verify-heading">Use the latest recovery code.</h1>
          <p>
            The code expires, has a limited number of attempts and cannot be replayed. Resetting the password revokes all current sessions.
          </p>
        </div>
      </section>
      <section className="auth-card-panel" aria-label="Complete password recovery">
        <div className="auth-card">
          <p className="eyebrow">{role} portal</p>
          <h2>Set a new password</h2>
          <RecoveryCompletionForm role={role} />
        </div>
      </section>
    </main>
  );
}
