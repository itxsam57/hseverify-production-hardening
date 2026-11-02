"use server";
import {revalidatePath} from "next/cache";
import type {DuplicateIdentityFormState} from "@/components/worker/duplicate-identity-review-form";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getDatabaseClient} from "@/lib/database/database";
import {DuplicateIdentityReviewService,DuplicateIdentityReviewError} from "@/lib/identity/duplicate-identity-review-service";
import {EvidenceReviewAccessError} from "@/lib/review/evidence-review-domain";
function text(form:FormData,key:string){const value=form.get(key);return typeof value==="string"?value:"";}
export async function resolveDuplicateIdentityAction(previous:DuplicateIdentityFormState,form:FormData):Promise<DuplicateIdentityFormState>{
 void previous;const actor=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 try{
  if(!/^(0|[1-9][0-9]*)$/.test(text(form,"expectedRevision")))throw new DuplicateIdentityReviewError("Reload the current review before saving.");
  await new DuplicateIdentityReviewService(await getDatabaseClient()).decide(actor,{identityId:text(form,"identityId"),identityVersionId:text(form,"identityVersionId"),checkId:text(form,"checkId"),expectedRevision:Number(text(form,"expectedRevision")),disposition:text(form,"disposition"),reason:text(form,"reason")});
 }catch(error){if(error instanceof DuplicateIdentityReviewError)return {error:error.message,message:null};if(error instanceof EvidenceReviewAccessError)return {error:"This duplicate identity review is unavailable to your current session.",message:null};throw error;}
 revalidatePath("/admin/operations/duplicate-identities");revalidatePath("/worker/identity");revalidatePath("/worker/profile");return {error:null,message:"Duplicate identity outcome recorded."};
}
