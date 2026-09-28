"use server";

import { redirect } from "next/navigation";

import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import {
  getSupervisorObservationService,
  SupervisorObservationInputError
} from "@/lib/review/supervisor-observation-service";

function value(formData: FormData, name: string): string {
  const item = formData.get(name);
  return typeof item === "string" ? item : "";
}

export async function createSupervisorObservationAction(formData: FormData): Promise<void> {
  const principal = await requireCurrentTenantPermission("company.orders.manage");
  try {
    if (value(formData, "signed") !== "yes") {
      throw new SupervisorObservationInputError("Supervisor declaration must be signed before submission.");
    }
    const observedAt = new Date(value(formData, "observedAt"));
    if (Number.isNaN(observedAt.getTime())) {
      throw new SupervisorObservationInputError("Observation date and time are invalid.");
    }
    await getSupervisorObservationService().create(principal, {
      caseId: value(formData, "caseId"),
      observerMembershipId: value(formData, "observerMembershipId"),
      frameworkReference: value(formData, "frameworkReference"),
      competencyReference: value(formData, "competencyReference"),
      taskReference: value(formData, "taskReference"),
      checklist: value(formData, "checklist").split("\n"),
      restrictions: value(formData, "restrictions"),
      observationText: value(formData, "observationText"),
      outcome: value(formData, "outcome") as "demonstrated" | "partially_demonstrated" | "not_demonstrated",
      supervisorDeclaration: value(formData, "supervisorDeclaration"),
      observedAt
    });
  } catch (error) {
    const message = error instanceof SupervisorObservationInputError
      ? error.message
      : "Supervisor observation could not be created.";
    redirect(`/company/observations?error=${encodeURIComponent(message)}`);
  }
  redirect("/company/observations?result=created");
}
