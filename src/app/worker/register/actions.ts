"use server";

import { redirect } from "next/navigation";

import type { OtpChannel } from "@/lib/auth/auth-domain";
import {
  AuthenticationSandboxError,
  readLatestAuthenticationSandboxCode
} from "@/lib/auth/auth-sandbox-service";
import {
  RegistrationServiceError,
  getWorkerRegistrationService
} from "@/lib/auth/worker-registration-service";
import {
  clearWorkerRegistrationToken,
  readWorkerRegistrationToken,
  writeWorkerRegistrationToken
} from "@/lib/auth/worker-registration-cookie";
import {
  CompanyWorkforceAccessError,
  CompanyWorkforceSecretError
} from "@/lib/company/company-workforce-domain";
import {
  bindCompanyWorkforceRegistrationToToken,
  clearCompanyWorkforceRegistrationBinding,
  readCompanyWorkforceRegistrationBinding,
  type CompanyWorkforceRegistrationBinding
} from "@/lib/company/company-workforce-registration-binding";
import {
  CompanyWorkforceRegistrationService,
  type CompanyWorkforceRegistrationResource
} from "@/lib/company/company-workforce-registration-service";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { getDatabaseClient } from "@/lib/database/database";
import { registrationRequestFingerprint } from "@/lib/http/registration-request";

export type RegistrationActionState = {
  error: string | null;
  message: string | null;
  retryAt: string | null;
  fieldErrors?: Partial<
    Record<
      "displayName" | "email" | "phone" | "password" | "confirmPassword" | "companyCode",
      string
    >
  >;
};

export type SandboxDeliveryState = {
  error: string | null;
  code: string | null;
  deliveryHint: string | null;
  createdAt: string | null;
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function actionError(error: unknown): RegistrationActionState {
  if (error instanceof RegistrationServiceError) {
    return {
      error: error.userMessage,
      message: null,
      retryAt: error.retryAt
    };
  }
  if (error instanceof CompanyWorkforceSecretError) {
    return {
      error: "That Company registration code or invitation is invalid, expired, revoked, or no longer available.",
      message: null,
      retryAt: null
    };
  }
  if (error instanceof CompanyWorkforceAccessError) {
    return {
      error: "The Company invitation does not match these Worker registration details.",
      message: null,
      retryAt: null
    };
  }
  return {
    error: "Registration could not be completed. Try again safely.",
    message: null,
    retryAt: null
  };
}

function resourceFromBinding(
  binding: CompanyWorkforceRegistrationBinding
): CompanyWorkforceRegistrationResource {
  return Object.freeze({
    kind: binding.kind,
    resourceId: binding.resourceId
  });
}

async function companyRegistrationService(): Promise<CompanyWorkforceRegistrationService> {
  const environment = getServerEnvironment();
  return new CompanyWorkforceRegistrationService(
    await getDatabaseClient(),
    environment.authPepper
  );
}

export async function startWorkerRegistration(
  _previousState: RegistrationActionState,
  formData: FormData
): Promise<RegistrationActionState> {
  const displayName = formText(formData, "displayName");
  const email = formText(formData, "email");
  const phone = formText(formData, "phone");
  const password = formText(formData, "password");
  const confirmPassword = formText(formData, "confirmPassword");
  const companyCode = formText(formData, "companyCode").trim();
  const fieldErrors: RegistrationActionState["fieldErrors"] = {};

  if (!displayName.trim()) fieldErrors.displayName = "Enter your full name.";
  if (!email.trim()) fieldErrors.email = "Enter your email address.";
  if (!phone.trim()) fieldErrors.phone = "Enter your phone number.";
  if (!password) fieldErrors.password = "Create a password.";
  if (password !== confirmPassword) {
    fieldErrors.confirmPassword = "The passwords do not match.";
  }

  let CompanyWorkforceRegistrationBinding = await readCompanyWorkforceRegistrationBinding();
  if (CompanyWorkforceRegistrationBinding?.registrationTokenHash) {
    await clearCompanyWorkforceRegistrationBinding();
    CompanyWorkforceRegistrationBinding = null;
  }
  if (CompanyWorkforceRegistrationBinding && companyCode) {
    fieldErrors.companyCode = "Leave the Company code blank because an invitation is already attached.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      error: "Check the highlighted registration details.",
      message: null,
      retryAt: null,
      fieldErrors
    };
  }

  try {
    const companyService = await companyRegistrationService();
    let companyResource: CompanyWorkforceRegistrationResource | null = null;
    if (CompanyWorkforceRegistrationBinding) {
      companyResource = resourceFromBinding(CompanyWorkforceRegistrationBinding);
      await companyService.assertRegistrationEmail(companyResource, email);
    } else if (companyCode) {
      companyResource = await companyService.prepareRegistrationCode(companyCode);
    }

    const service = await getWorkerRegistrationService();
    const result = await service.start({
      displayName,
      email,
      phone,
      password,
      requestFingerprint: await registrationRequestFingerprint()
    });
    await writeWorkerRegistrationToken(result.token);
    if (companyResource) {
      await bindCompanyWorkforceRegistrationToToken(companyResource, result.token);
    } else {
      await clearCompanyWorkforceRegistrationBinding();
    }
  } catch (error) {
    return actionError(error);
  }

  redirect("/worker/register/verify");
}

export async function cancelWorkerRegistration(): Promise<void> {
  const token = await readWorkerRegistrationToken();
  if (token) {
    const service = await getWorkerRegistrationService();
    await service.cancel(token);
  }
  await Promise.all([
    clearWorkerRegistrationToken(),
    clearCompanyWorkforceRegistrationBinding()
  ]);
  redirect("/worker/register?reason=cancelled");
}

export async function readSandboxDelivery(
  _previousState: SandboxDeliveryState,
  formData: FormData
): Promise<SandboxDeliveryState> {
  const channelValue = formText(formData, "channel");
  const channel: OtpChannel | null =
    channelValue === "email" || channelValue === "phone"
      ? channelValue
      : null;
  const destination = formText(formData, "destination");
  const accessKey = formText(formData, "accessKey");

  if (!channel || !destination || !accessKey) {
    return {
      error: "Enter the channel, destination and sandbox access key.",
      code: null,
      deliveryHint: null,
      createdAt: null
    };
  }

  try {
    const delivery = await readLatestAuthenticationSandboxCode({
      channel,
      destination,
      accessKey
    });
    return {
      error: null,
      code: delivery.code,
      deliveryHint: delivery.deliveryHint,
      createdAt: delivery.createdAt
    };
  } catch (error) {
    return {
      error:
        error instanceof AuthenticationSandboxError
          ? error.userMessage
          : "The sandbox delivery could not be opened.",
      code: null,
      deliveryHint: null,
      createdAt: null
    };
  }
}
