"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  AssessmentCatalogueAccessError,
  AssessmentCatalogueConflictError,
  AssessmentCatalogueInputError,
  type CatalogueStatus
} from "@/lib/assessment-catalogue/assessment-catalogue-domain";
import { getAssessmentCatalogueService } from "@/lib/assessment-catalogue/assessment-catalogue-service";

const PATH = "/admin/assessment-catalogue";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function minimumVerifiedQualifications(formData: FormData, name: string): number {
  const raw = text(formData, name).trim();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 50) {
    throw new AssessmentCatalogueInputError(
      "Minimum verified qualifications must be an integer from 0 to 50."
    );
  }
  return value;
}

function description(formData: FormData, name: string): string | null {
  const value = text(formData, name).trim();
  return value.length > 0 ? value : null;
}

function userMessage(error: unknown): string {
  if (
    error instanceof AssessmentCatalogueInputError ||
    error instanceof AssessmentCatalogueConflictError ||
    error instanceof AssessmentCatalogueAccessError
  ) {
    return error.message;
  }
  return "Assessment catalogue operation could not be completed safely.";
}

async function adminPrincipal() {
  return requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
}

function finishSuccess(message: string): never {
  revalidatePath("/admin/assessment-catalogue");
  redirect(`${PATH}?success=${encodeURIComponent(message)}`);
}

function finishError(error: unknown): never {
  redirect(`${PATH}?error=${encodeURIComponent(userMessage(error))}`);
}

export async function createAssessmentCatalogueEntryAction(formData: FormData): Promise<never> {
  try {
    const principal = await adminPrincipal();
    await (await getAssessmentCatalogueService()).createEntry(principal, {
      catalogueReference: text(formData, "catalogueReference"),
      version: {
        title: text(formData, "catalogueTitle"),
        description: description(formData, "description"),
        frameworkReference: text(formData, "frameworkReference"),
        blueprintVersionId: text(formData, "blueprintVersionId"),
        minimumVerifiedQualifications: minimumVerifiedQualifications(
          formData,
          "minimumVerifiedQualifications"
        )
      }
    });
  } catch (error) {
    finishError(error);
  }
  finishSuccess("Assessment catalogue entry created.");
}

export async function reviseAssessmentCatalogueEntryAction(formData: FormData): Promise<never> {
  try {
    const principal = await adminPrincipal();
    await (await getAssessmentCatalogueService()).reviseEntry(principal, {
      catalogueEntryId: text(formData, "catalogueEntryId"),
      expectedCurrentVersionId: text(formData, "expectedCurrentVersionId"),
      version: {
        title: text(formData, "revisionTitle"),
        description: description(formData, "revisionDescription"),
        frameworkReference: text(formData, "revisionFrameworkReference"),
        blueprintVersionId: text(formData, "revisionBlueprintVersionId"),
        minimumVerifiedQualifications: minimumVerifiedQualifications(
          formData,
          "revisionMinimumVerifiedQualifications"
        )
      }
    });
  } catch (error) {
    finishError(error);
  }
  finishSuccess("Immutable assessment catalogue revision published.");
}

export async function setAssessmentCatalogueStatusAction(formData: FormData): Promise<never> {
  try {
    const principal = await adminPrincipal();
    await (await getAssessmentCatalogueService()).setStatus(
      principal,
      text(formData, "catalogueEntryId"),
      text(formData, "catalogueStatus") as CatalogueStatus
    );
  } catch (error) {
    finishError(error);
  }
  finishSuccess("Assessment catalogue status updated.");
}
