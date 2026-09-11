import Link from "next/link";

import { cancelStaffEnrollment } from "@/app/staff/invite/accept/actions";
import {
  StaffProfileEnrollmentForm,
  StaffTotpEnrollmentForm
} from "@/app/staff/invite/accept/enrollment-forms";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { readStaffEnrollmentToken } from "@/lib/auth/staff-enrollment-cookie";
import { getStaffProvisioningService } from "@/lib/auth/staff-provisioning-service";

export default async function StaffEnrollmentPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<React.JSX.Element> {
  const { reason } = await searchParams;
  const token = await readStaffEnrollmentToken();
  const state = token
    ? await (await getStaffProvisioningService()).readEnrollmentState(token)
    : null;

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="staff-enrollment-heading">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Invitation-only access</p>
          <h1 id="staff-enrollment-heading">Create one isolated staff account.</h1>
          <p>
            Staff access is fixed to the invited role and cannot be switched after login. Authenticator enrollment is mandatory before the account can be used.
          </p>
        </div>
      </section>

      <section className="auth-card-panel" aria-label="Staff enrollment">
        <div className="auth-card">
          {!state ? (
            <>
              <h2>Invitation unavailable</h2>
              <Alert tone={reason === "cancelled" ? "success" : "danger"}>
                {reason === "cancelled"
                  ? "Enrollment was cancelled safely."
                  : "Open a valid staff invitation link to continue."}
              </Alert>
              <Link href="/">Return to the public website</Link>
            </>
          ) : state.step === "profile" ? (
            <>
              <p className="eyebrow">{state.role} portal</p>
              <h2>Create account credentials</h2>
              <p className="muted-copy">
                Invitation email: {state.email}. The account remains unusable until MFA is activated.
              </p>
              <StaffProfileEnrollmentForm />
              <form action={cancelStaffEnrollment}>
                <Button fullWidth type="submit" variant="ghost">
                  Cancel enrollment
                </Button>
              </form>
            </>
          ) : state.step === "totp" ? (
            <>
              <p className="eyebrow">Mandatory MFA</p>
              <h2>Add HSE Verify to an authenticator app</h2>
              <p className="muted-copy">
                Add the setup key manually, then enter a fresh code. The key is shown only inside this protected enrollment flow.
              </p>
              <div className="security-key-card">
                <span>Setup key</span>
                <strong>{state.totpSecret}</strong>
              </div>
              {state.otpauthUri ? (
                <p className="muted-copy">
                  Authenticator URI is available for compatible password managers and authenticator apps.
                </p>
              ) : null}
              <StaffTotpEnrollmentForm />
              <form action={cancelStaffEnrollment}>
                <Button fullWidth type="submit" variant="ghost">
                  Cancel enrollment
                </Button>
              </form>
            </>
          ) : (
            <>
              <h2>Enrollment complete</h2>
              <Alert tone="success">
                Password and authenticator setup are complete. Sign in through the {state.role} portal.
              </Alert>
              <Link className="button button-primary button-full" href={`/${state.role}/login`}>
                Open {state.role} sign in
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
