"use server";

import { redirect } from "next/navigation";

import { ROLE_LOGIN_PATHS } from "@/lib/auth/auth-domain";
import {
  clearStaffEnrollmentToken,
  readStaffEnrollmentToken
} from "@/lib/auth/staff-enrollment-cookie";
import {
  StaffProvisioningError,
  getStaffProvisioningService
} from "@/lib/auth/staff-provisioning-service";

export type StaffEnrollmentActionState = {
  error: string | null;
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function actionError(error: unknown): StaffEnrollmentActionState {
  return {
    error:
      error instanceof StaffProvisioningError
        ? error.userMessage
        : "Staff enrollment could not be completed safely."
  };
}

export async function completeStaffEnrollmentProfile(
  _previousState: StaffEnrollmentActionState,
  formData: FormData
): Promise<StaffEnrollmentActionState> {
  const token = await readStaffEnrollmentToken();
  if (!token) return { error: "Open the staff invitation again." };
  const password = formText(formData, "password");
  if (password !== formText(formData, "confirmPassword")) {
    return { error: "The passwords do not match." };
  }
  try {
    await (await getStaffProvisioningService()).completeProfile({
      combinedToken: token,
      displayName: formText(formData, "displayName"),
      password
    });
  } catch (error) {
    return actionError(error);
  }
  redirect("/staff/invite/accept");
}

export async function verifyStaffEnrollmentTotp(
  _previousState: StaffEnrollmentActionState,
  formData: FormData
): Promise<StaffEnrollmentActionState> {
  const token = await readStaffEnrollmentToken();
  if (!token) return { error: "Open the staff invitation again." };
  let role;
  try {
    role = (
      await (await getStaffProvisioningService()).verifyEnrollmentTotp({
        combinedToken: token,
        code: formText(formData, "code")
      })
    ).role;
    await clearStaffEnrollmentToken();
  } catch (error) {
    return actionError(error);
  }
  redirect(`${ROLE_LOGIN_PATHS[role]}?reason=enrollment-complete`);
}

export async function cancelStaffEnrollment(): Promise<void> {
  const token = await readStaffEnrollmentToken();
  if (token) {
    await (await getStaffProvisioningService()).cancelEnrollment(token);
  }
  await clearStaffEnrollmentToken();
  redirect("/staff/invite/accept?reason=cancelled");
}
