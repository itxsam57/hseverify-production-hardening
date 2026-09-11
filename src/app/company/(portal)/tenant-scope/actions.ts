"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  companyScopeDemoPayload,
  parseCompanyScopeDemoInput,
  parseExpectedVersion,
  parseFixtureId,
  type CompanyScopeDemoActionState
} from "@/lib/authorization/company-scope-demonstration-domain";
import {
  createTenantScopeFixture,
  deleteTenantScopeFixture,
  updateTenantScopeFixture
} from "@/lib/authorization/tenant-scope-fixture-service";
import { TenantScopeConflictError } from "@/lib/authorization/tenant-scoped-resource-domain";

const DEMONSTRATION_PATH = "/company/tenant-scope";

function invalidHiddenState(message: string): CompanyScopeDemoActionState {
  return Object.freeze({
    status: "error",
    message,
    fieldErrors: Object.freeze({})
  });
}

function conflictState(): CompanyScopeDemoActionState {
  return Object.freeze({
    status: "conflict",
    message:
      "That demonstration record changed or its key is already in use. The latest tenant-scoped state has been reloaded.",
    fieldErrors: Object.freeze({})
  });
}

export async function saveCompanyScopeDemonstrationAction(
  _previousState: CompanyScopeDemoActionState,
  formData: FormData
): Promise<CompanyScopeDemoActionState> {
  const intent = formData.get("intent");
  if (intent !== "create" && intent !== "update") {
    return invalidHiddenState("The demonstration action was not recognized.");
  }

  const parsed = parseCompanyScopeDemoInput(formData);
  if (!parsed.ok) return parsed.state;

  try {
    if (intent === "create") {
      await createTenantScopeFixture({
        recordKey: parsed.value.recordKey,
        payload: companyScopeDemoPayload(parsed.value)
      });
    } else {
      const fixtureId = parseFixtureId(formData);
      const expectedVersion = parseExpectedVersion(formData);
      if (!fixtureId || expectedVersion === null) {
        return invalidHiddenState(
          "The demonstration record identity or version is invalid. Reload and try again."
        );
      }
      await updateTenantScopeFixture({
        fixtureId,
        expectedVersion,
        recordKey: parsed.value.recordKey,
        payload: companyScopeDemoPayload(parsed.value)
      });
    }
  } catch (error) {
    if (error instanceof TenantScopeConflictError) {
      revalidatePath(DEMONSTRATION_PATH);
      return conflictState();
    }
    throw error;
  }

  revalidatePath(DEMONSTRATION_PATH);
  return Object.freeze({
    status: "success",
    message:
      intent === "create"
        ? "Demonstration record created inside the current Company tenant."
        : "Demonstration record updated inside the current Company tenant.",
    fieldErrors: Object.freeze({})
  });
}

export async function deleteCompanyScopeDemonstrationRecord(
  fixtureId: string
): Promise<void> {
  if (!/^tenantfixture_[A-Za-z0-9_-]{24}$/.test(fixtureId)) {
    redirect(`${DEMONSTRATION_PATH}?result=unchanged`);
  }

  const deleted = await deleteTenantScopeFixture({ fixtureId });
  revalidatePath(DEMONSTRATION_PATH);
  redirect(
    `${DEMONSTRATION_PATH}?result=${deleted ? "deleted" : "unchanged"}`
  );
}
