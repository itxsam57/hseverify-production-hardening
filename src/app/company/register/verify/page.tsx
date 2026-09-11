import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  CompanyEmailVerificationForm,
  CompanyMfaVerificationForm
} from "@/app/company/register/company-registration-forms";
import { BrandMark } from "@/components/brand-mark";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { readCompanyRegistrationToken } from "@/lib/company/company-registration-cookie";
import { getCompanyRegistrationService } from "@/lib/company/company-registration-service";

export const metadata: Metadata = {
  title: "Verify Company registration | HSE Verify"
};

export default async function CompanyRegistrationVerifyPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<React.JSX.Element> {
  const token = await readCompanyRegistrationToken();
  if (!token) redirect("/company/register?reason=expired");
  const service = await getCompanyRegistrationService();
  const state = await service.readState(token);
  if (!state) redirect("/company/register?reason=expired");
  if (state.step === "complete") redirect("/company/login?reason=registration-complete");
  const { reason } = await searchParams;
  const environment = getServerEnvironment();

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="company-registration-verification-title">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Company account security</p>
          <h1 id="company-registration-verification-title">
            {state.step === "pending_email" ? "Verify the business email." : "Secure the Company account with an authenticator."}
          </h1>
          <p>
            The Company application reference is {state.applicationReference}. Verification authority remains server-side and cannot be selected by the browser.
          </p>
        </div>
        <p className="auth-security-note">
          Completing account security does not verify the Company. The tenant stays pending until Company evidence is submitted and the verification decision is accepted.
        </p>
      </section>
      <section className="auth-card-panel" aria-label="Company registration verification">
        <div className="auth-card">
          <p className="eyebrow">{state.step === "pending_email" ? "Step 1 of 2" : "Step 2 of 2"}</p>
          <h2>{state.step === "pending_email" ? "Business email" : "Authenticator"}</h2>
          {state.step === "pending_email" ? (
            <CompanyEmailVerificationForm
              deliveryHint={state.deliveryHint}
              sandboxEnabled={environment.authSandboxEnabled}
              statusMessage={reason === "resent" ? "A new verification code was sent." : null}
            />
          ) : (
            <CompanyMfaVerificationForm setupKey={state.totpSetupKey ?? ""} />
          )}
        </div>
      </section>
    </main>
  );
}
