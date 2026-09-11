import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CompanyRegistrationForm } from "@/app/company/register/company-registration-forms";
import { BrandMark } from "@/components/brand-mark";
import { readCompanyRegistrationToken } from "@/lib/company/company-registration-cookie";
import { getCompanyRegistrationService } from "@/lib/company/company-registration-service";

export const metadata: Metadata = {
  title: "Company registration | HSE Verify"
};

export default async function CompanyRegistrationPage(): Promise<React.JSX.Element> {
  const token = await readCompanyRegistrationToken();
  if (token) {
    const state = await (await getCompanyRegistrationService()).readState(token);
    if (state) redirect("/company/register/verify");
  }

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand-panel" aria-labelledby="company-registration-title">
        <BrandMark light />
        <div className="auth-brand-copy">
          <p className="eyebrow eyebrow-light">Company registration</p>
          <h1 id="company-registration-title">Create a verified Company workspace.</h1>
          <p>
            Register the legal organization and authorized representative. The Company remains pending and high-risk workforce functions stay disabled until verification is accepted.
          </p>
        </div>
        <p className="auth-security-note">
          Duplicate registrations are blocked conservatively. Company evidence stays in private secure storage and is never published as a public upload URL.
        </p>
      </section>

      <section className="auth-card-panel" aria-labelledby="company-registration-form-title">
        <div className="auth-card">
          <p className="eyebrow">Organization application</p>
          <h2 id="company-registration-form-title">Company details</h2>
          <p className="muted-copy">
            These details create a pending Company tenant, its owner account, and version 1 of the verification case.
          </p>
          <CompanyRegistrationForm />
          <div className="auth-footer-links">
            <Link href="/company/login">Already registered? Company sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
