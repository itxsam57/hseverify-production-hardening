"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getEvidenceReviewService} from "@/lib/review/evidence-review-service";
import {EvidenceReviewConflictError,EvidenceReviewInputError} from "@/lib/review/evidence-review-domain";
export async function returnEvidenceEscalationAction(form:FormData){
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const taskId=form.get("taskId"),revision=form.get("revision"),reason=form.get("reason");let result="returned";
 try{if(typeof taskId!=="string"||typeof revision!=="string"||!/^[1-9][0-9]*$/.test(revision))throw new EvidenceReviewInputError();
 await(await getEvidenceReviewService()).returnEscalation(principal,taskId,Number(revision),reason);
 }catch(error){if(error instanceof EvidenceReviewConflictError)result="conflict";else if(error instanceof EvidenceReviewInputError)result="invalid";else throw error;}
 revalidatePath("/admin/operations/review-escalations");revalidatePath("/verifier/reviews");
 redirect("/admin/operations/review-escalations?result="+result);
}
