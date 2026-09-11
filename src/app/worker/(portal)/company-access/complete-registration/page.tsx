import { completeCompanyWorkforceRegistrationAction } from "@/app/worker/(portal)/company-access/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { readCompanyWorkforceRegistrationBinding } from "@/lib/company/company-workforce-registration-binding";

export default async function CompleteCompanyWorkforceRegistrationPage(): Promise<React.JSX.Element> {
  await requirePortalAuthorization("worker");
  const binding = await readCompanyWorkforceRegistrationBinding();
  const ready = Boolean(binding?.registrationTokenHash);

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Verified Worker registration</p>
          <h1>Finish Company link</h1>
          <p className="page-intro">
            Your Worker account is active. HSE Verify will verify that this Company handoff belongs to the same completed registration flow before using the invitation or Company code.
          </p>
        </div>
      </header>

      {ready ? (
        <section className="panel page-section content-stack">
          <Alert tone="neutral">
            Company access is not activated during email or phone OTP steps. It is finalized only now, after the registration flow is complete and you have signed into the Worker Portal.
          </Alert>
          <form action={completeCompanyWorkforceRegistrationAction}>
            <Button type="submit">Finish Company link</Button>
          </form>
        </section>
      ) : (
        <Alert tone="warning">
          The registration Company handoff is unavailable or expired. You can still use a current Company registration code from the Company access page.
        </Alert>
      )}
    </div>
  );
}
