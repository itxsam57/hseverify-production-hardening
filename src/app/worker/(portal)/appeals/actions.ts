"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { AppealFollowupAccessError, AppealFollowupConflictError, CredentialAppealFollowupService } from "@/lib/credential/credential-appeal-followup-service";
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
export async function respondCredentialAppealEvidenceAction(formData:FormData):Promise<void>{
 const principal=await requirePortalAuthorization("worker");
 const appealId=text(formData,"appealId"),requestId=text(formData,"requestId"),raw=text(formData,"expectedVersion"),expectedVersion=Number(raw),reason=text(formData,"reason");
 if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(expectedVersion)||expectedVersion>2147483646)redirect("/worker/appeals?error=conflict");
 if(reason.length<10||reason.length>4000)redirect("/worker/appeals?error=reason");
 const evidence:{recordId:string;versionId:string}[]=[];
 try{for(const value of formData.getAll("evidenceVersionReferences")){
  if(typeof value!=="string")throw new Error("Invalid evidence reference");
  const item=JSON.parse(value) as {recordId?:unknown;versionId?:unknown};
  if(typeof item.recordId!=="string"||typeof item.versionId!=="string")throw new Error("Invalid evidence reference");
  evidence.push({recordId:item.recordId,versionId:item.versionId});
 }}catch{redirect("/worker/appeals?error=evidence");}
 if(!evidence.length||evidence.length>20)redirect("/worker/appeals?error=evidence");
 try{await new CredentialAppealFollowupService().respondEvidence({principal,appealId,requestId,expectedVersion,reason,evidence});}
 catch(error){if(error instanceof AppealFollowupConflictError)redirect("/worker/appeals?error=conflict");if(error instanceof AppealFollowupAccessError)redirect("/worker/appeals?error=evidence");throw error;}
 revalidatePath("/worker/appeals");revalidatePath("/admin/appeals");redirect("/worker/appeals?status=response");
}
