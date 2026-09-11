"use server";

import { redirect } from "next/navigation";

import { registrationRequestFingerprint } from "@/lib/http/registration-request";
import {
  clearCompanyRegistrationToken,
  readCompanyRegistrationToken,
  writeCompanyRegistrationToken
} from "@/lib/company/company-registration-cookie";
import {
  CompanyRegistrationServiceError,
  getCompanyRegistrationService
} from "@/lib/company/company-registration-service";

export type CompanyRegistrationActionState = Readonly<{
  status: "idle" | "error" | "success";
  message: string | null;
  retryAt: string | null;
  fieldErrors: Readonly<Record<string, string>>;
}>;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function errorState(
  message: string,
  retryAt: string | null = null,
  fieldErrors: Readonly<Record<string, string>> = {}
): CompanyRegistrationActionState {
  return Object.freeze({
    status: "error" as const,
    message,
    retryAt,
    fieldErrors: Object.freeze({ ...fieldErrors })
  });
}

function actionFailure(error: unknown): CompanyRegistrationActionState {
  if (error instanceof CompanyRegistrationServiceError) {
    return errorState(error.userMessage, error.retryAt);
  }
  return errorState(
    "Company registration could not be completed safely. No partial verification decision was created."
  );
}

export async function startCompanyRegistrationAction(
  _previousState: CompanyRegistrationActionState,
  formData: FormData
): Promise<CompanyRegistrationActionState> {
  const password = text(formData, "password");
  const confirmPassword = text(formData, "confirmPassword");
  const required = [
    ["legalName", "Enter the legal Company name."],
    ["tradingName", "Enter the trading name."],
    ["registrationNumber", "Enter the registration number."],
    ["country", "Enter the registration country."],
    ["industry", "Enter the industry."],
    ["companySize", "Select the Company size."],
    ["website", "Enter the Company website."],
    ["authorizedRepresentative", "Enter the authorized representative."],
    ["businessEmail", "Enter the business email."],
    ["businessPhone", "Enter the business phone."],
    ["password", "Create a password."]
  ] as const;
  const fieldErrors: Record<string, string> = {};
  for (const [name, message] of required) {
    if (!text(formData, name).trim()) fieldErrors[name] = message;
  }
  if (password !== confirmPassword) {
    fieldErrors.confirmPassword = "The passwords do not match.";
  }
  if (!checked(formData, "termsAccepted")) {
    fieldErrors.termsAccepted = "Accept the terms to continue.";
  }
  if (!checked(formData, "privacyAccepted")) {
    fieldErrors.privacyAccepted = "Accept the privacy notice to continue.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return errorState("Check the highlighted Company registration details.", null, fieldErrors);
  }

  try {
    const service = await getCompanyRegistrationService();
    const result = await service.start({
      legalName: text(formData, "legalName"),
      tradingName: text(formData, "tradingName"),
      registrationNumber: text(formData, "registrationNumber"),
      country: text(formData, "country"),
      industry: text(formData, "industry"),
      companySize: text(formData, "companySize"),
      website: text(formData, "website"),
      authorizedRepresentative: text(formData, "authorizedRepresentative"),
      businessEmail: text(formData, "businessEmail"),
      businessPhone: text(formData, "businessPhone"),
      password,
      termsAccepted: checked(formData, "termsAccepted"),
      privacyAccepted: checked(formData, "privacyAccepted"),
      requestFingerprint: await registrationRequestFingerprint()
    });
    await writeCompanyRegistrationToken(result.token);
  } catch (error) {
    return actionFailure(error);
  }
  redirect("/company/register/verify");
}

export async function verifyCompanyEmailAction(
  _previousState: CompanyRegistrationActionState,
  formData: FormData
): Promise<CompanyRegistrationActionState> {
  const token = await readCompanyRegistrationToken();
  if (!token) {
    return errorState("This Company registration session is no longer available. Start again.");
  }
  const code = text(formData, "code");
  if (!/^\d{6}$/.test(code.trim())) {
    return errorState("Enter the 6-digit email verification code.", null, {
      code: "A 6-digit code is required."
    });
  }
  try {
    const service = await getCompanyRegistrationService();
    await service.verifyEmail({
      token,
      code,
      requestFingerprint: await registrationRequestFingerprint()
    });
  } catch (error) {
    return actionFailure(error);
  }
  redirect("/company/register/verify");
}

export async function resendCompanyEmailAction(): Promise<void> {
  const token = await readCompanyRegistrationToken();
  if (!token) redirect("/company/register?reason=expired");
  const service = await getCompanyRegistrationService();
  await service.resendEmail({
    token,
    requestFingerprint: await registrationRequestFingerprint()
  });
  redirect("/company/register/verify?reason=resent");
}

export async function verifyCompanyMfaAction(
  _previousState: CompanyRegistrationActionState,
  formData: FormData
): Promise<CompanyRegistrationActionState> {
  const token = await readCompanyRegistrationToken();
  if (!token) {
    return errorState("This Company registration session is no longer available. Start again.");
  }
  const code = text(formData, "code");
  if (!/^\d{6}$/.test(code.trim())) {
    return errorState("Enter the 6-digit authenticator code.", null, {
      code: "A 6-digit authenticator code is required."
    });
  }
  try {
    const service = await getCompanyRegistrationService();
    await service.verifyMfa({
      token,
      code,
      requestFingerprint: await registrationRequestFingerprint()
    });
    await clearCompanyRegistrationToken();
  } catch (error) {
    return actionFailure(error);
  }
  redirect("/company/login?reason=registration-complete");
}
