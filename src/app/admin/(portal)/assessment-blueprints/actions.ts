"use server";

import { redirect } from "next/navigation";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {
  AssessmentBlueprintAccessError,
  AssessmentBlueprintConflictError,
  AssessmentBlueprintInputError,
  type BlueprintStatus
} from "@/lib/assessment-generation/assessment-blueprint-domain";
import { getAssessmentBlueprintService } from "@/lib/assessment-generation/assessment-blueprint-service";

const PATH = "/admin/assessment-blueprints";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function selectors(formData: FormData, name: string): readonly unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(formData, name));
  } catch {
    throw new AssessmentBlueprintInputError("Selector JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new AssessmentBlueprintInputError("Selector JSON must be an array.");
  }
  return parsed;
}

function userMessage(error: unknown): string {
  if (
    error instanceof AssessmentBlueprintInputError ||
    error instanceof AssessmentBlueprintConflictError ||
    error instanceof AssessmentBlueprintAccessError
  ) {
    return error.message;
  }
  return "Assessment blueprint operation could not be completed safely.";
}

async function adminPrincipal() {
  return requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
}

function finishSuccess(message: string): never {
  redirect(`${PATH}?success=${encodeURIComponent(message)}`);
}

function finishError(error: unknown): never {
  redirect(`${PATH}?error=${encodeURIComponent(userMessage(error))}`);
}

export async function createAssessmentBlueprintAction(formData: FormData): Promise<never> {
  try {
    const principal = await adminPrincipal();
    await (await getAssessmentBlueprintService()).createBlueprint(principal, {
      blueprintReference: text(formData, "blueprintReference"),
      version: {
        title: text(formData, "blueprintTitle"),
        frameworkReference: text(formData, "frameworkReference"),
        selectors: selectors(formData, "selectorsJson")
      }
    });
  } catch (error) {
    finishError(error);
  }
  finishSuccess("Assessment blueprint created.");
}

export async function reviseAssessmentBlueprintAction(formData: FormData): Promise<never> {
  try {
    const principal = await adminPrincipal();
    await (await getAssessmentBlueprintService()).reviseBlueprint(principal, {
      blueprintId: text(formData, "blueprintId"),
      expectedCurrentVersionId: text(formData, "expectedCurrentVersionId"),
      version: {
        title: text(formData, "revisionTitle"),
        frameworkReference: text(formData, "revisionFrameworkReference"),
        selectors: selectors(formData, "revisionSelectorsJson")
      }
    });
  } catch (error) {
    finishError(error);
  }
  finishSuccess("Immutable blueprint revision published.");
}

export async function setAssessmentBlueprintStatusAction(formData: FormData): Promise<never> {
  try {
    const principal = await adminPrincipal();
    await (await getAssessmentBlueprintService()).setStatus(
      principal,
      text(formData, "blueprintId"),
      text(formData, "blueprintStatus") as BlueprintStatus
    );
  } catch (error) {
    finishError(error);
  }
  finishSuccess("Assessment blueprint status updated.");
}
