import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkerVerificationForm } from "@/app/worker/register/registration-forms";
import styles from "@/app/worker/register/registration.module.css";
import { BrandMark } from "@/components/brand-mark";
import { Alert } from "@/components/ui/feedback";
import { PRODUCT_COPY } from "@/config/product-copy";
import { readWorkerRegistrationChallengeBinding } from "@/lib/auth/worker-registration-challenge-binding";
import { readWorkerRegistrationToken } from "@/lib/auth/worker-registration-cookie";
import { getWorkerRegistrationService } from "@/lib/auth/worker-registration-service";
import { readCompanyWorkforceRegistrationBinding } from "@/lib/company/company-workforce-registration-binding";
import { getServerEnvironment } from "@/lib/config/server-environment";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify Worker contacts | HSE Verify"
};

type VerificationPageProps = {
  searchParams: Promise<{
    error?: string;
    status?: string;
  }>;
};

const VERIFICATION_ERRORS: Record<string, string> = {
  "invalid-format": "Enter the latest six-digit code exactly as shown.",
  "invalid-code": "That code was not accepted. Open the test-code inbox and use the latest code.",
  "stale-code": "That code belongs to an older verification request. Open the inbox again and use the newest code.",
  expired: "That code expired. Send a new code and open the inbox again.",
  cooldown: "Wait until the resend timer finishes before requesting another code.",
  unavailable: "Verification could not be completed. Try the latest code again."
};

export default async function WorkerRegistrationVerificationPage({
  searchParams
}: VerificationPageProps): Promise<React.JSX.Element> {
  const token = await readWorkerRegistrationToken();
  if (!token) {
    redirect("/worker/register?reason=restart");
  }

  const service = await getWorkerRegistrationService();
  const state = await service.readState(token);
  if (!state) {
    redirect("/worker/register?reason=restart");
  }

  const environment = getServerEnvironment();
  const copy = PRODUCT_COPY.workerRegistration;
  const pendingStep =
    state.step === "pending_email" || state.step === "pending_phone"
      ? state.step
      : null;
  const isComplete = pendingStep === null;
  const binding = pendingStep
    ? await readWorkerRegistrationChallengeBinding(token)
    : null;
  const companyBinding = isComplete
    ? await readCompanyWorkforceRegistrationBinding()
    : null;
  const hasCompanyHandoff = Boolean(companyBinding?.registrationTokenHash);
  const challengeId =
    binding && binding.step === pendingStep ? binding.challengeId : null;
  const query = await searchParams;
  const errorMessage = query.error
    ? VERIFICATION_ERRORS[query.error] ?? VERIFICATION_ERRORS.unavailable
    : challengeId
      ? null
      : "No active verification code exists. Send a new code to continue.";
  const statusMessage =
    query.status === "resent"
      ? "A new code was created. Open the test-code inbox and use only the newest code."
      : null;

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="verification-intro-title">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Contact verification</p>
          <h1 id="verification-intro-title">
            {isComplete ? "Your Worker account is active" : "Verify your contact details"}
          </h1>
          <p>
            {isComplete
              ? hasCompanyHandoff
                ? "Both checks are complete. Sign in to the Worker Portal to finish the verified Company link."
                : "Both checks are complete. Sign in separately to enter the Worker portal."
              : copy.verificationOrder}
          </p>
        </div>
        <p className="auth-security-note">
          Use only the latest code for the contact shown on this page.
        </p>
      </section>

      <section className="auth-card-panel" aria-labelledby="verification-card-title">
        <div className="auth-card">
          <p className="eyebrow">Worker registration</p>
          <h2 id="verification-card-title">
            {isComplete
              ? "Activation complete"
              : pendingStep === "pending_email"
                ? copy.emailStepTitle
                : copy.phoneStepTitle}
          </h2>

          {pendingStep ? (
            <WorkerVerificationForm
              key={`${pendingStep}:${challengeId ?? "missing"}`}
              challengeExpiresAt={state.challengeExpiresAt}
              challengeId={challengeId}
              deliveryHint={state.deliveryHint ?? "your contact"}
              errorMessage={errorMessage}
              resendAvailableAt={state.resendAvailableAt}
              sandboxEnabled={environment.authSandboxEnabled}
              statusMessage={statusMessage}
              step={pendingStep}
            />
          ) : (
            <>
              <Alert tone="success">
                Email and phone verification passed.
              </Alert>
              {hasCompanyHandoff ? (
                <Alert tone="neutral">
                  The Company invitation/code was not consumed during OTP verification. It is bound to this completed registration flow and will be re-checked after Worker sign-in.
                </Alert>
              ) : null}
              <div className={styles.completionCard}>
                <strong>Provisional registration reference</strong>
                <p className={styles.reference}>
                  {state.workerReference ?? "Reference unavailable"}
                </p>
                <p>
                  This is not the permanent public Worker ID. Permanent ID issuance belongs to the Worker Identity Engine.
                </p>
              </div>
              <div className={styles.linkRow}>
                <Link href="/">Return to public website</Link>
                <Link
                  href={
                    hasCompanyHandoff
                      ? "/worker/login?returnTo=/worker/company-access/complete-registration"
                      : "/worker/login"
                  }
                >
                  {hasCompanyHandoff ? "Worker sign-in and finish Company link" : "Worker sign-in"}
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
