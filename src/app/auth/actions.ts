"use server";

import { redirect } from "next/navigation";

import {
  ROLE_LOGIN_PATHS,
  type AuthRole
} from "@/lib/auth/auth-domain";
import { safeRoleLoginReturnPath } from "@/lib/auth/auth-login-return";
import {
  AuthenticationLoginError,
  getAuthLoginService
} from "@/lib/auth/auth-login-service";
import { readAuthenticationRequestMetadata } from "@/lib/auth/auth-request";
import {
  establishAuthenticationSession,
  revokeCurrentAuthenticationSession
} from "@/lib/auth/auth-session-service";

export type RoleLoginActionState = {
  error: string | null;
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signInForRole(
  role: AuthRole,
  formData: FormData
): Promise<RoleLoginActionState> {
  const metadata = await readAuthenticationRequestMetadata();
  try {
    const authenticated = await (await getAuthLoginService()).signIn({
      role,
      email: formText(formData, "email"),
      password: formText(formData, "password"),
      verificationCode: formText(formData, "verificationCode"),
      requestFingerprint: metadata.fingerprint
    });
    await establishAuthenticationSession({
      accountId: authenticated.accountId,
      role,
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
      requestFingerprint: metadata.fingerprint
    });
  } catch (error) {
    return {
      error:
        error instanceof AuthenticationLoginError
          ? error.userMessage
          : "Sign-in could not be completed safely. Try again."
    };
  }
  redirect(safeRoleLoginReturnPath(role, formText(formData, "returnTo")));
}

export async function signInWorkerAccount(
  _previousState: RoleLoginActionState,
  formData: FormData
): Promise<RoleLoginActionState> {
  return signInForRole("worker", formData);
}

export async function signInCompanyAccount(
  _previousState: RoleLoginActionState,
  formData: FormData
): Promise<RoleLoginActionState> {
  return signInForRole("company", formData);
}

export async function signInAssessorAccount(
  _previousState: RoleLoginActionState,
  formData: FormData
): Promise<RoleLoginActionState> {
  return signInForRole("assessor", formData);
}

export async function signInVerifierAccount(
  _previousState: RoleLoginActionState,
  formData: FormData
): Promise<RoleLoginActionState> {
  return signInForRole("verifier", formData);
}

export async function signInAdminAccount(
  _previousState: RoleLoginActionState,
  formData: FormData
): Promise<RoleLoginActionState> {
  return signInForRole("admin", formData);
}

export async function signInRootAccount(
  _previousState: RoleLoginActionState,
  formData: FormData
): Promise<RoleLoginActionState> {
  return signInForRole("root", formData);
}

export async function signOutCurrentPortal(): Promise<void> {
  const role = await revokeCurrentAuthenticationSession();
  redirect(`${ROLE_LOGIN_PATHS[role ?? "worker"]}?reason=signed-out`);
}
