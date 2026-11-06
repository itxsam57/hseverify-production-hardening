"use server";
import {revalidatePath} from "next/cache";
import type {ReviewQualityFormState} from "@/components/review/review-quality-form";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getDatabaseClient} from "@/lib/database/database";
import {EvidenceReviewAccessError,EvidenceReviewConflictError} from "@/lib/review/evidence-review-domain";
import {ReviewQualityInputError} from "@/lib/review/review-quality-domain";
import {ReviewQualityService} from "@/lib/review/review-quality-service";
function text(form:FormData,key:string){const value=form.get(key);return typeof value==="string"?value:"";}
async function save(previous:ReviewQualityFormState,form:FormData,mode:"selection"|"capacity"):Promise<ReviewQualityFormState>{
 void previous;
 const actor=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const service=new ReviewQualityService(await getDatabaseClient());
 try{
  if(mode==="selection")await service.requireSecond(actor,{taskId:text(form,"taskId"),reason:text(form,"reason")});
  else{
   if(!/^[1-9][0-9]*$/.test(text(form,"maxOpenReviews"))||!/^(0|[1-9][0-9]*)$/.test(text(form,"expectedRevision")))throw new ReviewQualityInputError("A current staffing revision and a whole-number workload limit are required.");
   await service.setCapacity(actor,{accountId:text(form,"accountId"),maxOpenReviews:Number(text(form,"maxOpenReviews")),expectedRevision:Number(text(form,"expectedRevision")),reason:text(form,"reason")});
  }
 }catch(error){
  if(error instanceof EvidenceReviewConflictError||error instanceof ReviewQualityInputError)return {error:error.message,message:null};
  if(error instanceof EvidenceReviewAccessError)return {error:"This operational review is unavailable to your current session.",message:null};
  throw error;
 }
 revalidatePath("/admin/operations/review-quality");revalidatePath("/verifier/reviews");revalidatePath("/admin/operations/scoring-assignments");
 return {error:null,message:mode==="selection"?"Independent second review is required.":"Reviewer workload limit saved."};
}
export async function requireIndependentReviewAction(previous:ReviewQualityFormState,form:FormData){return save(previous,form,"selection");}
export async function saveReviewerCapacityAction(previous:ReviewQualityFormState,form:FormData){return save(previous,form,"capacity");}
