"use server";

import { redirect } from "next/navigation";

import {
  isAuthRole,
  ROLE_LOGIN_PATHS,
  type AuthRole
} from "@/lib/auth/auth-domain";
import {
  AuthenticationRecoveryError,
  getAuthRecoveryService
} from "@/lib/auth/auth-recovery-service";
import {
  clearRecoveryToken,
  readRecoveryToken,
  writeRecoveryToken
} from "@/lib/auth/auth-recovery-cookie";
import { readAuthenticationRequestMetadata } from "@/lib/auth/auth-request";

export type RecoveryActionState = {
  error: string | null;
  message: string | null;
  retryAt: string | null;
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function recoveryError(error: unknown): RecoveryActionState {
  return {
    error:
      error instanceof AuthenticationRecoveryError
        ? error.userMessage
        : "Password recovery could not be completed safely.",
    message: null,
    retryAt:
      error instanceof AuthenticationRecoveryError ? error.retryAt : null
  };
}

function roleFromForm(formData: FormData): AuthRole {
  const value = formText(formData, "role");
  return isAuthRole(value) ? value : "worker";
}

export async function requestPasswordRecovery(
  _previousState: RecoveryActionState,
  formData: FormData
): Promise<RecoveryActionState> {
  const role = roleFromForm(formData);
  try {
    const service = await getAuthRecoveryService();
    const result = await service.request({
      role,
      email: formText(formData, "email"),
      requestFingerprint: (await readAuthenticationRequestMetadata()).fingerprint
    });
    await writeRecoveryToken(result.token);
  } catch (error) {
    return recoveryError(error);
  }
  redirect(`/auth/recover/verify?portal=${role}`);
}

export async function completePasswordRecovery(
  _previousState: RecoveryActionState,
  formData: FormData
): Promise<RecoveryActionState> {
  const token = await readRecoveryToken();
  if (!token) {
    return {
      error: "Start password recovery again.",
      message: null,
      retryAt: null
    };
  }
  const password = formText(formData, "password");
  const confirmPassword = formText(formData, "confirmPassword");
  if (password !== confirmPassword) {
    return {
      error: "The passwords do not match.",
      message: null,
      retryAt: null
    };
  }
  let role: AuthRole;
  try {
    const service = await getAuthRecoveryService();
    role = (
      await service.resetPassword({
        token,
        code: formText(formData, "code"),
        password
      })
    ).role;
    await clearRecoveryToken();
  } catch (error) {
    return recoveryError(error);
  }
  redirect(`${ROLE_LOGIN_PATHS[role]}?reason=password-reset`);
}

export async function resendPasswordRecoveryCode(
  previousState: RecoveryActionState,
  formData: FormData
): Promise<RecoveryActionState> {
  void previousState;
  void formData;
  const token = await readRecoveryToken();
  if (!token) {
    return {
      error: "Start password recovery again.",
      message: null,
      retryAt: null
    };
  }
  try {
    await (await getAuthRecoveryService()).resend({ token });
    return {
      error: null,
      message: "A new recovery code has been issued.",
      retryAt: null
    };
  } catch (error) {
    return recoveryError(error);
  }
}
