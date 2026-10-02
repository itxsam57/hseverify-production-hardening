"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { CredentialAppealsRepository } from "@/lib/credential/credential-appeals-repository";
import { CredentialAppealsService } from "@/lib/credential/credential-appeals-service";
import { CredentialIssuanceRepository } from "@/lib/credential/credential-issuance-repository";
import { getDatabaseClient } from "@/lib/database/database";
import { WorkerEvidenceService } from "@/lib/worker-evidence/worker-evidence-service";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitCredentialAppealAction(formData: FormData): Promise<void> {
  const [principal, session] = await Promise.all([
    requirePortalAuthorization("worker"),
    requireWorkerSession()
  ]);
  const credentialId = text(formData, "credentialId");
  const reason = text(formData, "reason");
  if (reason.length < 10) {
    redirect("/worker/appeals?error=reason");
  }

  const credential = await new CredentialIssuanceRepository().findPublic(credentialId);
  if (!credential || credential.workerId !== session.workerId) {
    redirect("/worker/appeals?error=credential");
  }

  const records = await new WorkerEvidenceService(getDatabaseClient()).listCurrent(principal);
  const owned = new Set(records.map((record) => record.recordId));
  const selected = formData
    .getAll("evidenceRecordIds")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  if (selected.some((recordId) => !owned.has(recordId))) {
    redirect("/worker/appeals?error=evidence");
  }

  try {
    await new CredentialAppealsService().submit({
      credentialId,
      workerId: session.workerId,
      reason,
      evidence: selected,
      createdAt: new Date().toISOString()
    }, randomBytes(12).toString("hex"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("already open")) {
      redirect("/worker/appeals?error=open");
    }
    throw error;
  }

  revalidatePath("/worker/appeals");
  revalidatePath("/worker/dashboard");
  redirect("/worker/appeals?status=submitted");
}

export async function withdrawCredentialAppealAction(formData: FormData): Promise<void> {
  const session = await requireWorkerSession();
  const appealId = text(formData, "appealId");
  const repository = new CredentialAppealsRepository();
  const appeal = await repository.find(appealId);
  if (!appeal || appeal.workerId !== session.workerId) {
    redirect("/worker/appeals?error=appeal");
  }
  await new CredentialAppealsService().withdraw(appeal, session.workerId);
  revalidatePath("/worker/appeals");
  revalidatePath("/worker/dashboard");
  redirect("/worker/appeals?status=withdrawn");
}