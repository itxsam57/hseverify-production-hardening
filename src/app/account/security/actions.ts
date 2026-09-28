"use server";

import { revalidatePath } from "next/cache";

import {
  AccountSecurityInputError,
  getAccountSecurityService
} from "@/lib/auth/account-security-service";
import { requireAuthenticatedSession } from "@/lib/auth/auth-session-service";

export type SecurityActionState = Readonly<{
  error: string | null;
  message: string | null;
  recoveryCodes?: readonly string[];
  mfaRotation?: Readonly<{
    challengeId: string;
    secret: string;
    setupUri: string;
  }> | null;
}>;

const EMPTY: SecurityActionState = Object.freeze({ error: null, message: null });

function value(formData: FormData, name: string): string {
  const item = formData.get(name);
  return typeof item === "string" ? item : "";
}

function failure(error: unknown): SecurityActionState {
  return {
    error: error instanceof AccountSecurityInputError
      ? error.message
      : "Security operation could not be completed safely.",
    message: null
  };
}

export async function changePasswordAction(
  _previous: SecurityActionState = EMPTY,
  formData: FormData
): Promise<SecurityActionState> {
  const session = await requireAuthenticatedSession();
  try {
    const newPassword = value(formData, "newPassword");
    if (newPassword !== value(formData, "confirmPassword")) {
      throw new AccountSecurityInputError("New password confirmation does not match.");
    }
    await getAccountSecurityService().changePassword({
      session,
      currentPassword: value(formData, "currentPassword"),
      newPassword,
      mfaCode: value(formData, "mfaCode")
    });
    revalidatePath("/account/security");
    revalidatePath("/worker/security");
    return { error: null, message: "Password changed. Other active sessions were revoked." };
  } catch (error) {
    return failure(error);
  }
}

export async function rotateRecoveryCodesAction(
  _previous: SecurityActionState = EMPTY,
  formData: FormData
): Promise<SecurityActionState> {
  const session = await requireAuthenticatedSession();
  try {
    const recoveryCodes = await getAccountSecurityService().rotateRecoveryCodes({
      session,
      currentPassword: value(formData, "currentPassword"),
      mfaCode: value(formData, "mfaCode")
    });
    revalidatePath("/account/security");
    revalidatePath("/worker/security");
    return {
      error: null,
      message: "Recovery codes rotated. Save these codes now; they are shown once.",
      recoveryCodes
    };
  } catch (error) {
    return failure(error);
  }
}

export async function startMfaReplacementAction(
  _previous: SecurityActionState = EMPTY,
  formData: FormData
): Promise<SecurityActionState> {
  const session = await requireAuthenticatedSession();
  try {
    const rotation = await getAccountSecurityService().startMfaReplacement({
      session,
      currentPassword: value(formData, "currentPassword"),
      mfaCode: value(formData, "mfaCode")
    });
    return {
      error: null,
      message: "Add the new secret to your authenticator, then confirm one code.",
      mfaRotation: rotation
    };
  } catch (error) {
    return failure(error);
  }
}

export async function confirmMfaReplacementAction(
  _previous: SecurityActionState = EMPTY,
  formData: FormData
): Promise<SecurityActionState> {
  const session = await requireAuthenticatedSession();
  try {
    await getAccountSecurityService().confirmMfaReplacement({
      session,
      challengeId: value(formData, "challengeId"),
      newCode: value(formData, "newCode")
    });
    revalidatePath("/account/security");
    return { error: null, message: "Authenticator replaced successfully." };
  } catch (error) {
    return failure(error);
  }
}
