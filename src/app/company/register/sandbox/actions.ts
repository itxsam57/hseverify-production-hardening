"use server";

import {
  AuthenticationSandboxError,
  readLatestAuthenticationSandboxCode
} from "@/lib/auth/auth-sandbox-service";

export type CompanySandboxState = Readonly<{
  error: string | null;
  code: string | null;
  deliveryHint: string | null;
  createdAt: string | null;
}>;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function readCompanySandboxDelivery(
  _previousState: CompanySandboxState,
  formData: FormData
): Promise<CompanySandboxState> {
  const destination = text(formData, "destination");
  const accessKey = text(formData, "accessKey");
  if (!destination.trim() || !accessKey) {
    return Object.freeze({
      error: "Enter the business email and sandbox access key.",
      code: null,
      deliveryHint: null,
      createdAt: null
    });
  }
  try {
    const delivery = await readLatestAuthenticationSandboxCode({
      channel: "email",
      destination,
      accessKey
    });
    return Object.freeze({
      error: null,
      code: delivery.code,
      deliveryHint: delivery.deliveryHint,
      createdAt: delivery.createdAt
    });
  } catch (error) {
    return Object.freeze({
      error:
        error instanceof AuthenticationSandboxError
          ? error.userMessage
          : "The sandbox delivery could not be opened.",
      code: null,
      deliveryHint: null,
      createdAt: null
    });
  }
}
