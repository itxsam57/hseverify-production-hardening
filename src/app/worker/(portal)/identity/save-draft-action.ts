"use server";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import {
  WorkerIdentityContactVerificationRequiredError,
  type WorkerIdentityDraftInput
} from "@/lib/identity/worker-identity-draft-domain";
import { getWorkerIdentityDraftService } from "@/lib/identity/worker-identity-draft-service";
import {
  INITIAL_WORKER_IDENTITY_DRAFT_SAVE_STATE,
  type WorkerIdentityDraftSaveState
} from "@/lib/identity/worker-identity-draft-save-state";
import {
  WorkerIdentityAccessDeniedError,
  WorkerIdentityConflictError,
  WorkerIdentityContractError,
  WorkerIdentityNotFoundError
} from "@/lib/identity/worker-identity-domain";

function state(
  status: WorkerIdentityDraftSaveState["status"],
  message: string,
  draftRevision: number | null = null,
  fieldErrors: Readonly<Record<string, string>> = {}
): WorkerIdentityDraftSaveState {
  return Object.freeze({
    status,
    message,
    fieldErrors: Object.freeze(fieldErrors),
    draftRevision
  });
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function optionalText(formData: FormData, name: string): string | null {
  const value = text(formData, name).trim();
  return value.length === 0 ? null : value;
}

function integer(formData: FormData, name: string): number | null {
  const value = text(formData, name);
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function failure(error: unknown): WorkerIdentityDraftSaveState {
  if (error instanceof WorkerIdentityConflictError) {
    return state(
      "conflict",
      "Your identity changed in another request. The latest state has been reloaded; review it before trying again."
    );
  }
  if (error instanceof WorkerIdentityContactVerificationRequiredError) {
    return state(
      "error",
      "Verified email and phone are required before identity details can be saved."
    );
  }
  if (error instanceof WorkerIdentityAccessDeniedError) {
    return state(
      "error",
      "Your current session no longer has permission to change this identity. Sign in again if the session expired."
    );
  }
  if (error instanceof WorkerIdentityContractError) {
    return state("error", error.message);
  }
  if (error instanceof WorkerIdentityNotFoundError) {
    return state(
      "error",
      "The Worker identity record is unavailable. Reload the page and try again."
    );
  }
  return state(
    "error",
    "The identity request could not be completed safely. No accepted identity history was overwritten."
  );
}

export async function saveWorkerIdentityDraftWithRevisionAction(
  _previousState: WorkerIdentityDraftSaveState = INITIAL_WORKER_IDENTITY_DRAFT_SAVE_STATE,
  formData: FormData
): Promise<WorkerIdentityDraftSaveState> {
  const expectedDraftRevision = integer(formData, "expectedDraftRevision");
  const hasDraft = text(formData, "hasDraft") === "true";
  if (hasDraft && expectedDraftRevision === null) {
    return state("error", "The identity form is stale. Reload the page and try again.");
  }

  const input: WorkerIdentityDraftInput = {
    legalFirstName: optionalText(formData, "legalFirstName"),
    legalLastName: optionalText(formData, "legalLastName"),
    previousLegalName: optionalText(formData, "previousLegalName"),
    dateOfBirth: optionalText(formData, "dateOfBirth"),
    nationality: optionalText(formData, "nationality"),
    countryOfResidence: optionalText(formData, "countryOfResidence")
  };

  try {
    const principal = await requirePortalAuthorization("worker");
    const saved = await getWorkerIdentityDraftService().save(
      principal,
      input,
      hasDraft ? expectedDraftRevision : null
    );
    return state("success", "Identity details saved.", saved.draftRevision);
  } catch (error) {
    return failure(error);
  }
}
