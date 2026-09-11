import { completePreparedCompanyInvitationAction } from "@/app/worker/(portal)/company-access/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { readCompanyWorkforceRegistrationBinding } from "@/lib/company/company-workforce-registration-binding";

export default async function CompletePreparedCompanyInvitationPage(): Promise<React.JSX.Element> {
  await requirePortalAuthorization("worker");
  const binding = await readCompanyWorkforceRegistrationBinding();
  const ready = Boolean(
    binding &&
    binding.kind === "invitation" &&
    binding.registrationTokenHash === null
  );

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Worker invitation</p>
          <h1>Finish Company invitation</h1>
          <p className="page-intro">
            Your Worker session is active. HSE Verify will now re-check the prepared invitation, invited email, verified Company status and current link state before activating Company access.
          </p>
        </div>
      </header>

      {ready ? (
        <section className="panel page-section content-stack">
          <Alert tone="neutral">
            The invitation secret was not carried through login. This step uses the signed server-prepared invitation reference and your live Worker account.
          </Alert>
          <form action={completePreparedCompanyInvitationAction}>
            <Button type="submit">Finish Company link</Button>
          </form>
        </section>
      ) : (
        <Alert tone="warning">
          This invitation handoff is unavailable or expired. Return to the current Company invitation link or ask the Company to resend it.
        </Alert>
      )}
    </div>
  );
}
