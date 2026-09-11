"use server";

import { revalidatePath } from "next/cache";

import { requireWorkerSession } from "@/lib/auth/worker-session";
import type { ProfileActionState } from "@/lib/worker/profile-action-state";
import {
  PROFILE_SECTIONS,
  type ProfileSection
} from "@/lib/worker/profile-domain";
import {
  ProfileStorageConfigurationError,
  ProfileVersionConflictError
} from "@/lib/worker/profile-repository";
import {
  ProfileSubmissionError,
  SensitiveProfileFieldsLockedError,
  requestWorkerProfileCorrection,
  saveWorkerProfileSection,
  submitWorkerProfile
} from "@/lib/worker/profile-service";

function formValues(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string")
  );
}

function readSection(value: FormDataEntryValue | null): ProfileSection | null {
  return typeof value === "string" &&
    PROFILE_SECTIONS.includes(value as ProfileSection)
    ? (value as ProfileSection)
    : null;
}

function readVersion(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

function submissionErrors(error: ProfileSubmissionError): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

function actionFailure(error: unknown): ProfileActionState {
  if (error instanceof ProfileVersionConflictError) {
    return {
      status: "conflict",
      message:
        "Your profile changed in another request. Reloaded data is required before saving again.",
      fieldErrors: {},
      nextSection: null
    };
  }
  if (error instanceof SensitiveProfileFieldsLockedError) {
    return {
      status: "error",
      message:
        "Verified identity fields cannot be overwritten. Submit a correction request instead.",
      fieldErrors: Object.fromEntries(
        error.fields.map((field) => [field, "This verified field is locked."])
      ),
      nextSection: null
    };
  }
  if (error instanceof ProfileSubmissionError) {
    const fieldErrors = submissionErrors(error);
    return {
      status: "error",
      message:
        Object.keys(fieldErrors).length > 0
          ? "Correct the highlighted fields and try again."
          : error.message,
      fieldErrors,
      nextSection: null
    };
  }
  if (error instanceof ProfileStorageConfigurationError) {
    return {
      status: "error",
      message:
        "Worker Profile storage is not configured for this environment.",
      fieldErrors: {},
      nextSection: null
    };
  }

  return {
    status: "error",
    message: "The profile request could not be completed safely.",
    fieldErrors: {},
    nextSection: null
  };
}

function revalidateWorkerProfile(): void {
  revalidatePath("/worker/profile");
  revalidatePath("/worker/onboarding");
  revalidatePath("/worker/dashboard");
}

export async function saveWorkerProfileSectionAction(
  _previousState: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const section = readSection(formData.get("section"));
  const expectedVersion = readVersion(formData.get("expectedVersion"));
  const continueToNext = formData.get("intent") === "continue";
  if (!section || expectedVersion === null) {
    return {
      status: "error",
      message: "The profile form state is invalid. Reload the page and try again.",
      fieldErrors: {},
      nextSection: null
    };
  }

  try {
    const identity = await requireWorkerSession();
    const result = await saveWorkerProfileSection({
      identity,
      section,
      fields: formValues(formData),
      expectedVersion
    });
    revalidateWorkerProfile();
    return {
      status: "success",
      message: "Profile section saved.",
      fieldErrors: {},
      nextSection: continueToNext ? result.nextSection : null
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function submitWorkerProfileAction(
  _previousState: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const expectedVersion = readVersion(formData.get("expectedVersion"));
  if (expectedVersion === null) {
    return {
      status: "error",
      message: "The profile form state is invalid. Reload the page and try again.",
      fieldErrors: {},
      nextSection: null
    };
  }

  try {
    const identity = await requireWorkerSession();
    await submitWorkerProfile({ identity, expectedVersion });
    revalidateWorkerProfile();
    return {
      status: "success",
      message: "Profile submitted successfully.",
      fieldErrors: {},
      nextSection: null
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function requestWorkerProfileCorrectionAction(
  _previousState: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const expectedVersion = readVersion(formData.get("expectedVersion"));
  if (expectedVersion === null) {
    return {
      status: "error",
      message: "The correction form state is invalid. Reload and try again.",
      fieldErrors: {},
      nextSection: null
    };
  }

  try {
    const identity = await requireWorkerSession();
    await requestWorkerProfileCorrection({
      identity,
      expectedVersion,
      fields: formValues(formData)
    });
    revalidateWorkerProfile();
    return {
      status: "success",
      message: "Correction request submitted for review.",
      fieldErrors: {},
      nextSection: null
    };
  } catch (error) {
    return actionFailure(error);
  }
}
