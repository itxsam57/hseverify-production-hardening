"use server";
import {revalidatePath} from "next/cache";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getDatabaseClient} from "@/lib/database/database";
import {WrittenReviewAssignmentError,WrittenReviewAssignmentService} from "@/lib/scoring/written-review-assignment-service";

export async function assignScoringReviewAction(_state:{message:string;success:boolean},form:FormData):Promise<{message:string;success:boolean}>{
 const actor=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const text=(name:string)=>{const value=form.get(name);return typeof value==="string"?value:"";};
 let message="Assessment review assigned.",success=true;
 try{
  const revision=text("expectedRevision");
  if(!/^(0|[1-9][0-9]*)$/.test(revision))throw new WrittenReviewAssignmentError("Reload the current review before assigning.");
  await new WrittenReviewAssignmentService(await getDatabaseClient()).assign(actor,{caseId:text("caseId"),reviewerAccountId:text("reviewerAccountId"),expectedReviewId:text("expectedReviewId")||null,expectedRevision:Number(revision),reason:text("reason")});
 }catch(error){if(!(error instanceof WrittenReviewAssignmentError))throw error;message=error.message;success=false;}
 revalidatePath("/admin/operations/scoring-assignments");
 revalidatePath("/verifier/reviews/scoring");
 revalidatePath("/company/action-centre");
 return {message,success};
}
