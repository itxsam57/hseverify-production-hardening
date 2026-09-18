"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";

export async function submitPrivacyRequestAction(formData: FormData) {
  const principal = await requirePortalAuthorization("worker");
  const type = String(formData.get("type") ?? "access");
  const service = new PrivacyOperationsService();
  if (!["access", "correction", "export", "deletion"].includes(type)) {
    throw new Error("invalid privacy request");
  }
  await service.request({ requestId: randomUUID(), tenantId: principal.tenantMembership?.tenantId ?? null, workerId: principal.accountId, type: type as "access" | "correction" | "export" | "deletion" });
  revalidatePath("/worker/privacy");
}

export async function submitAccommodationAction(formData: FormData) {
  const principal = await requirePortalAuthorization("worker");
  const type = String(formData.get("type") ?? "");
  if (!type) throw new Error("invalid accommodation");
  await new PrivacyOperationsService().accommodation({ id: randomUUID(), tenantId: principal.tenantMembership?.tenantId ?? null, workerId: principal.accountId, type });
  revalidatePath("/worker/privacy");
}
