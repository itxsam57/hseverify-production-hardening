"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { CertificationRecordRepository } from "@/lib/credential/certification-record-repository";

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export async function createCertificationRecordAction(formData: FormData): Promise<void> {
  const principal = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
  await new CertificationRecordRepository().create({
    certificationId: crypto.randomUUID(),
    credentialId: text(formData, "credentialId"),
    workerId: text(formData, "workerId"),
    qualification: text(formData, "qualification"),
    status: text(formData, "status") || "approved",
    decisionReason: text(formData, "reason") || "admin certification decision",
    createdBy: principal.accountId,
    createdAt: new Date().toISOString()
  });
  revalidatePath("/admin/certifications");
}
