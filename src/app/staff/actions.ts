"use server";

import { isAuthRole } from "@/lib/auth/auth-domain";
import { readAuthenticationRequestMetadata } from "@/lib/auth/auth-request";
import { requireRoleSession } from "@/lib/auth/auth-session-service";
import {
  StaffProvisioningError,
  getStaffProvisioningService,
  type StaffRole
} from "@/lib/auth/staff-provisioning-service";

export type StaffInvitationActionState = {
  error: string | null;
  invitationPath: string | null;
  invitedEmail: string | null;
  invitedRole: StaffRole | null;
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function staffRoleFromForm(formData: FormData): StaffRole | null {
  const value = formText(formData, "role");
  return isAuthRole(value) && value !== "worker" ? value : null;
}

function invitationError(error: unknown): StaffInvitationActionState {
  return {
    error:
      error instanceof StaffProvisioningError
        ? error.userMessage
        : "The staff invitation could not be created safely.",
    invitationPath: null,
    invitedEmail: null,
    invitedRole: null
  };
}

async function createInvitationForRole(
  inviterRole: "admin" | "root",
  formData: FormData
): Promise<StaffInvitationActionState> {
  const role = staffRoleFromForm(formData);
  if (!role) {
    return invitationError(
      new StaffProvisioningError("invalid_input", "Choose a valid staff role.")
    );
  }
  const session = await requireRoleSession(inviterRole);
  try {
    const result = await (await getStaffProvisioningService()).createInvitation({
      inviterAccountId: session.accountId,
      inviterRole,
      email: formText(formData, "email"),
      role,
      requestFingerprint: (await readAuthenticationRequestMetadata()).fingerprint
    });
    return {
      error: null,
      invitationPath: `/staff/invite/${result.token}`,
      invitedEmail: result.invitation.email,
      invitedRole: result.invitation.role
    };
  } catch (error) {
    return invitationError(error);
  }
}

export async function createAdminStaffInvitation(
  _previousState: StaffInvitationActionState,
  formData: FormData
): Promise<StaffInvitationActionState> {
  return createInvitationForRole("admin", formData);
}

export async function createRootStaffInvitation(
  _previousState: StaffInvitationActionState,
  formData: FormData
): Promise<StaffInvitationActionState> {
  return createInvitationForRole("root", formData);
}

export async function createRootBootstrapInvitation(
  _previousState: StaffInvitationActionState,
  formData: FormData
): Promise<StaffInvitationActionState> {
  try {
    const result = await (
      await getStaffProvisioningService()
    ).createRootBootstrapInvitation({
      email: formText(formData, "email"),
      accessKey: formText(formData, "accessKey"),
      requestFingerprint: (await readAuthenticationRequestMetadata()).fingerprint
    });
    return {
      error: null,
      invitationPath: `/staff/invite/${result.token}`,
      invitedEmail: result.invitation.email,
      invitedRole: "root"
    };
  } catch (error) {
    return invitationError(error);
  }
}
