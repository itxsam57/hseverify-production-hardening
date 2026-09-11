import { WorkerCompanyInvitationChoice } from "@/components/worker/worker-company-invitation-choice";
import { Alert } from "@/components/ui/feedback";
import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { getDatabaseClient } from "@/lib/database/database";
import { CompanyWorkforceRegistrationService } from "@/lib/company/company-workforce-registration-service";

export default async function WorkerCompanyInvitationPage({
  params
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  let valid = false;
  try {
    const environment = getServerEnvironment();
    const registration = new CompanyWorkforceRegistrationService(
      await getDatabaseClient(),
      environment.authPepper
    );
    await registration.prepareInvitation(token);
    valid = true;
  } catch {
    valid = false;
  }

  const resolution = await readServerAuthorizationContext();
  const sessionKind = resolution.allowed
    ? resolution.principal.activeRole === "worker"
      ? "worker"
      : "other"
    : "none";

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="worker-company-invitation-heading">
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">HSE Verify · Worker invitation</p>
          <h1 id="worker-company-invitation-heading">Join a verified Company without giving up ownership of your Worker identity.</h1>
          <p>
            A Company invitation can add Site, Department and future payment defaults, but your Worker profile, evidence and permanent Worker-ID remain controlled by HSE Verify and you.
          </p>
        </div>
        <p className="auth-security-note">
          New Workers still complete mandatory email and phone verification. Existing Workers must use their isolated Worker Portal session.
        </p>
      </section>

      <section className="auth-card-panel" aria-label="Worker Company invitation">
        <div className="auth-card content-stack">
          <div>
            <p className="eyebrow">Invitation status</p>
            <h2>{valid ? "Worker invitation ready" : "Invitation unavailable"}</h2>
            <p className="muted-copy">
              {valid
                ? "Choose Create Worker account or Worker sign-in. HSE Verify re-checks this invitation again when the Company link is completed."
                : "This invitation may be invalid, expired, revoked, already used, or replaced by a newer invitation."}
            </p>
          </div>

          {valid ? (
            <WorkerCompanyInvitationChoice token={token} sessionKind={sessionKind} />
          ) : (
            <Alert tone="warning">
              Ask the Company to issue or resend a current Worker invitation. HSE Verify does not reveal which invitation condition failed.
            </Alert>
          )}
        </div>
      </section>
    </main>
  );
}
