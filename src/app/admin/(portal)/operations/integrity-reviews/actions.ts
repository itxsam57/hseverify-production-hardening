"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getDatabaseClient} from "@/lib/database/database";
import {RECENT_MFA_ERROR} from "@/lib/auth/recent-mfa-service";
import type {IntegrityFormState} from "@/components/review/integrity-review-form";
import {IntegrityReviewService,IntegrityReviewInputError,IntegrityReviewConflictError} from "@/lib/integrity/integrity-review-service";
export async function returnIntegrityEscalationAction(previous:IntegrityFormState,form:FormData):Promise<IntegrityFormState>{
 void previous;
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const reviewId=form.get("reviewId"),revision=form.get("revision"),count=form.get("eventCount"),reason=form.get("reason");
 if(typeof reviewId!=="string"||typeof reason!=="string"||typeof revision!=="string"||typeof count!=="string"||! /^[1-9][0-9]*$/.test(revision)||! /^[1-9][0-9]*$/.test(count))return {error:"Provide a valid reason and current history reference."};
 try{await new IntegrityReviewService(await getDatabaseClient()).returnEscalation(principal,{reviewId,expectedRevision:Number(revision),expectedEventCount:Number(count),reason});}
 catch(error){if(error instanceof IntegrityReviewInputError || error instanceof IntegrityReviewConflictError)return {error:error.message};if(error instanceof Error && error.message===RECENT_MFA_ERROR)return {error:"Sign out and sign in with MFA, then return this escalation."};throw error;}
 revalidatePath("/admin/operations/integrity-reviews");
 revalidatePath("/verifier/reviews/scoring");
 redirect("/admin/operations/integrity-reviews?result=returned");
}
