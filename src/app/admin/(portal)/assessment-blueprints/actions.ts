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
import {
  ASSESSMENT_PROGRESSION_MODES,
  type AssessmentDeliverySettingsInput,
  type AssessmentProgressionMode
} from "@/lib/assessment-generation/assessment-delivery-settings";

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

function deliverySettings(
  formData: FormData,
  prefix = ""
): AssessmentDeliverySettingsInput {
  const progression = text(formData, `${prefix}progressionMode`) || "STRICT";
  if (!ASSESSMENT_PROGRESSION_MODES.includes(progression as AssessmentProgressionMode)) {
    throw new AssessmentBlueprintInputError("Progression mode is invalid.");
  }
  let sections: readonly { title: string; endPosition: number }[] = [];
  const sectionsText = text(formData, `${prefix}sectionsJson`).trim();
  if (sectionsText) {
    let parsed: unknown;
    try { parsed = JSON.parse(sectionsText); } catch {
      throw new AssessmentBlueprintInputError("Section JSON must be valid JSON.");
    }
    if (!Array.isArray(parsed)) {
      throw new AssessmentBlueprintInputError("Section JSON must be an array.");
    }
    sections = parsed.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new AssessmentBlueprintInputError("Section definition is invalid.");
      }
      const row = item as Record<string, unknown>;
      return {
        title: typeof row.title === "string" ? row.title : "",
        endPosition: Number(row.endPosition)
      };
    });
  }
  return {
    progressionMode: progression as AssessmentProgressionMode,
    sections,
    requireCamera: text(formData, `${prefix}requireCamera`) === "yes",
    requireMicrophone: text(formData, `${prefix}requireMicrophone`) === "yes",
    requireScreenShare: text(formData, `${prefix}requireScreenShare`) === "yes",
    recordCamera: text(formData, `${prefix}recordCamera`) === "yes",
    recordMicrophone: text(formData, `${prefix}recordMicrophone`) === "yes",
    recordScreen: text(formData, `${prefix}recordScreen`) === "yes",
    recordingRetentionDays: Number(text(formData, `${prefix}recordingRetentionDays`) || "30"),
    integrityFailureMode: text(formData, `${prefix}integrityFailureMode`) === "BLOCK" ? "BLOCK" : "REVIEW",
    requireFullscreen: text(formData, `${prefix}requireFullscreen`) === "yes",
    requireEnvironmentDeclaration: text(formData, `${prefix}requireEnvironmentDeclaration`) === "yes",
    requireMonitoringConsent: text(formData, `${prefix}requireMonitoringConsent`) === "yes"
  };
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
      },
      delivery: deliverySettings(formData)
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
      },
      delivery: deliverySettings(formData, "revision")
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