"use server";

import type {IntegrityFormState} from "@/components/review/integrity-review-form";
import { IntegrityReviewService,IntegrityReviewInputError,IntegrityReviewConflictError } from "@/lib/integrity/integrity-review-service";
import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import {WrittenScoringAccessError} from "@/lib/scoring/written-scoring-authority";
import { ScoringRecoveryError, WrittenScoringService } from "@/lib/scoring/written-scoring-service";
import { getDatabaseClient } from "@/lib/database/database";
import { WrittenScoringAssistanceService } from "@/lib/scoring/written-scoring-assistance-service";

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
function integer(form: FormData, key: string): number {
  const value=text(form,key);
  if(!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Scoring revision is invalid.");
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)) throw new Error("Scoring revision is invalid.");
  return parsed;
}

export async function finalizeWrittenScoreAction(form: FormData) {
  const actor = await requirePlatformPermission({ expectedRole: "verifier", permission: "verification.assigned.decide" });
  await new WrittenScoringService(await getDatabaseClient(),actor).finalizeAndAdvance({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId,
    tenantId: actor.tenantMembership?.tenantId,
    assessorVisible: form.get("assessorVisible") === "on",
  });
  revalidatePath("/verifier/reviews");
  revalidatePath("/verifier/reviews/scoring");
}

export async function addWrittenScoreRubricMarkAction(form: FormData) {
  const actor = await requirePlatformPermission({ expectedRole: "verifier", permission: "verification.assigned.decide" });
  await new WrittenScoringService(await getDatabaseClient(),actor).addRubricMark({
    reviewId: text(form, "reviewId"),
    criterion: text(form, "criterion"),
    mark: Number(text(form, "mark")),
    reason: text(form, "markReason"),
    reviewerAccountId: actor.accountId,
    expectedRevision: integer(form,"expectedRevision"),
  });
  revalidatePath("/verifier/reviews/scoring");
}


export async function saveWrittenScoreDecisionAction(form: FormData) {
  const actor = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.decide"
  });
  await new WrittenScoringService(await getDatabaseClient(),actor).saveDraftDecision({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId,
    tenantId: actor.tenantMembership?.tenantId,
    expectedRevision: integer(form,"expectedRevision"),
    decision: text(form, "decision"),
    reason: text(form, "reason")
  });
  revalidatePath("/verifier/reviews/scoring");
}


export async function generateWrittenScoringAssistanceAction(form: FormData) {
  const actor = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.decide"
  });
  await new WrittenScoringAssistanceService().generate({
    reviewId: text(form, "reviewId"),
    reviewerAccountId: actor.accountId
  });
  revalidatePath("/verifier/reviews/scoring");
}

export async function reviewWrittenScoringAssistanceAction(form: FormData) {
  const actor = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.decide"
  });
  const decision = text(form, "guidanceDecision");
  if (decision !== "ACCEPTED_AS_GUIDANCE" && decision !== "REJECTED") {
    throw new Error("AI guidance decision is invalid.");
  }
  await new WrittenScoringAssistanceService().reviewGuidance({
    assistanceId: text(form, "assistanceId"),
    reviewerAccountId: actor.accountId,
    decision,
    reason: text(form, "guidanceReason")
  });
  revalidatePath("/verifier/reviews/scoring");
}

export async function resolveIntegrityReviewAction(previous:IntegrityFormState,form: FormData):Promise<IntegrityFormState> {
 void previous;
 const actor=await requirePlatformPermission({expectedRole:"verifier",permission:"verification.assigned.decide"});
 const count=text(form,"integrityEventCount");
 if (!/^[1-9][0-9]*$/.test(count) || !/^(0|[1-9][0-9]*)$/.test(text(form,"integrityRevision"))) return {error:"Integrity history reference is invalid. Reload this review."};
 try{await new IntegrityReviewService(await getDatabaseClient()).resolve(actor,{reviewId:text(form,"reviewId"),disposition:text(form,"integrityDisposition"),reason:text(form,"integrityReason"),expectedEventCount:Number(count),expectedRevision:integer(form,"integrityRevision")});}
 catch(error){if(error instanceof IntegrityReviewConflictError || error instanceof IntegrityReviewInputError)return {error:error.message};throw error;}
 revalidatePath("/verifier/reviews/scoring");
 revalidatePath("/admin/operations");
 return {error:null};
}

export async function declareWrittenScoringConflictAction(previous:import("@/components/review/scoring-recovery-form").ScoringRecoveryState,form:FormData):Promise<import("@/components/review/scoring-recovery-form").ScoringRecoveryState>{
 return scoringRecovery(previous,form,"conflict");
}
export async function beginWrittenScoringAmendmentAction(previous:import("@/components/review/scoring-recovery-form").ScoringRecoveryState,form:FormData):Promise<import("@/components/review/scoring-recovery-form").ScoringRecoveryState>{
 return scoringRecovery(previous,form,"amendment");
}
async function scoringRecovery(previous:import("@/components/review/scoring-recovery-form").ScoringRecoveryState,form:FormData,mode:"conflict"|"amendment"):Promise<import("@/components/review/scoring-recovery-form").ScoringRecoveryState>{
 void previous;
 const actor=await requirePlatformPermission({expectedRole:"verifier",permission:"verification.assigned.decide"});
 const reason=text(form,"reason").trim();
 if(reason.length<5||reason.length>4000)return {error:"Enter a reason between 5 and 4000 characters.",message:null};
 const service=new WrittenScoringService(await getDatabaseClient(),actor);
 try{
  const input={reviewId:text(form,"reviewId"),reviewerAccountId:actor.accountId,reason};
  if(mode==="conflict")await service.recordConflict({...input,expectedRevision:integer(form,"expectedRevision")});
  else await service.beginAmendment(input);
 }catch(error){
  if(error instanceof ScoringRecoveryError)return {error:error.message,message:null};
  if(error instanceof WrittenScoringAccessError)return {error:"This review is unavailable to your current reviewer session. Reload before continuing.",message:null};
  throw error;
 }
 revalidatePath("/verifier/reviews/scoring");revalidatePath("/admin/operations/scoring-assignments");revalidatePath("/company/action-centre");
 return {error:null,message:mode==="conflict"?"Conflict recorded. Admin must assign an independent reviewer.":"Amendment started. Save every rubric mark and explicitly finalize the new decision."};
}
