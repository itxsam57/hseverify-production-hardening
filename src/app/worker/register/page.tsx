import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkerRegistrationForm } from "@/app/worker/register/registration-forms";
import { BrandMark } from "@/components/brand-mark";
import { PRODUCT_COPY } from "@/config/product-copy";
import { readWorkerRegistrationToken } from "@/lib/auth/worker-registration-cookie";
import { getWorkerRegistrationService } from "@/lib/auth/worker-registration-service";

export const metadata: Metadata = {
  title: "Worker registration | HSE Verify"
};

type RegistrationPageProps = {
  searchParams: Promise<{ reason?: string; company?: string }>;
};

export default async function WorkerRegistrationPage({
  searchParams
}: RegistrationPageProps): Promise<React.JSX.Element> {
  const token = await readWorkerRegistrationToken();
  if (token) {
    const service = await getWorkerRegistrationService();
    const state = await service.readState(token);
    if (state) {
      redirect("/worker/register/verify");
    }
  }

  const { reason, company } = await searchParams;
  const copy = PRODUCT_COPY.workerRegistration;

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="registration-intro-title">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">{copy.pageEyebrow}</p>
          <h1 id="registration-intro-title">{copy.pageTitle}</h1>
          <p>{copy.pageDescription}</p>
        </div>
        <p className="auth-security-note">
          Your account stays inactive until both contact checks pass.
        </p>
      </section>

      <section className="auth-card-panel" aria-labelledby="registration-form-title">
        <div className="auth-card">
          <p className="eyebrow">{copy.cardEyebrow}</p>
          <h2 id="registration-form-title">{copy.cardTitle}</h2>
          <p className="muted-copy">{copy.cardDescription}</p>
          <WorkerRegistrationForm
            cancelled={reason === "cancelled"}
            companyInvitation={company === "invitation"}
          />
        </div>
      </section>
    </main>
  );
}
