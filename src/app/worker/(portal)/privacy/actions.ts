"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
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
  const generalDescription=String(formData.get("requestDescription")??"").trim();
  if(generalDescription.length>2000) throw new Error("Privacy request description is too long.");
  let details:Record<string,unknown>=generalDescription?{description:generalDescription}:{};
  if(type==="correction" && formData.get("correctionScope")==="profile_contact_city") {
    details={correction:{scope:"profile_contact_city",city:String(formData.get("correctionCity")??""),
      expectedProfileVersion:Number(formData.get("profileVersion"))}};
  } else if(type==="deletion" && formData.get("deletionScope")==="expired_recording") {
    details={deletion:{scope:"expired_recording",recordingAssetId:String(formData.get("recordingAssetId")??"")}};
  } else if(type==="restriction") details={purpose:"optional_sharing"};
  else if(type==="share_link_revocation" && String(formData.get("shareLinkId")??"").trim()) details={shareLinkId:String(formData.get("shareLinkId")).trim()};
  else if(type==="consent_withdrawal" && String(formData.get("consentId")??"").trim()) details={consentId:String(formData.get("consentId")).trim()};
  try {
  await service.request({
    requestId: randomUUID(),
    tenantId: principal.tenantMembership?.tenantId ?? null,
    workerId: principal.accountId,
    type: type as PrivacyRequestType,
    details
  });
  } catch {
    redirect("/worker/privacy?privacyError=invalid_request");
  }
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
