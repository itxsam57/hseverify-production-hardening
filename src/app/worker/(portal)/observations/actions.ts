"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getSupervisorObservationService } from "@/lib/review/supervisor-observation-service";

export async function acknowledgeObservationAction(formData: FormData): Promise<void> {
  const principal = await requirePortalAuthorization("worker");
  const observationId = String(formData.get("observationId") ?? "");
  const comment = String(formData.get("comment") ?? "");
  await getSupervisorObservationService().acknowledge(principal, observationId, comment);
  revalidatePath("/worker/observations");
  redirect("/worker/observations?result=acknowledged");
}
