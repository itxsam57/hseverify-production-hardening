"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";
import { PRIVACY_REQUEST_TYPES, type PrivacyRequestType } from "@/lib/privacy/privacy-operations-domain";
import { ConsentRecordService } from "@/lib/privacy/consent-record-service";

export async function submitPrivacyRequestAction(formData: FormData) {
  const principal = await requirePortalAuthorization("worker");
  const type = String(formData.get("type") ?? "access");
  const service = new PrivacyOperationsService();
  if (!PRIVACY_REQUEST_TYPES.includes(type as PrivacyRequestType)) {
    throw new Error("invalid privacy request");
  }
  await service.request({
    requestId: randomUUID(),
    tenantId: principal.tenantMembership?.tenantId ?? null,
    workerId: principal.accountId,
    type: type as PrivacyRequestType
  });
  revalidatePath("/worker/privacy");
  revalidatePath("/worker/accessibility");
}

export async function submitAccommodationAction(formData: FormData) {
  const principal = await requirePortalAuthorization("worker");
  const type = String(formData.get("type") ?? "");
  if (!type) throw new Error("invalid accommodation");
  await new PrivacyOperationsService().accommodation({ id: randomUUID(), tenantId: principal.tenantMembership?.tenantId ?? null, workerId: principal.accountId, type });
  revalidatePath("/worker/privacy");
  revalidatePath("/worker/accessibility");
}


export async function withdrawConsentAction(formData: FormData) {
  const principal = await requirePortalAuthorization("worker");
  const consentId = String(formData.get("consentId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  await new ConsentRecordService().withdraw({
    workerId: principal.accountId,
    actorAccountId: principal.accountId,
    consentId,
    reason
  });
  revalidatePath("/worker/privacy");
  revalidatePath("/worker/share-links");
}
