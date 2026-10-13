"use server";

import { redirect } from "next/navigation";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getEvidenceReviewFrameworkService } from "@/lib/review/evidence-review-framework-service";
import { EvidenceReviewConflictError, EvidenceReviewInputError } from "@/lib/review/evidence-review-domain";
const value=(form:FormData,key:string)=>{const item=form.get(key);return typeof item==="string"?item:"";};
export async function bindReviewFrameworkAction(form:FormData):Promise<void>{
 const principal=await requirePortalAuthorization("admin");
 try{await getEvidenceReviewFrameworkService().bind(principal,{taskId:value(form,"taskId"),frameworkVersionId:value(form,"frameworkVersionId"),reason:value(form,"reason"),expectedBindingId:value(form,"expectedBindingId")||null});}
 catch(error){const message=error instanceof EvidenceReviewConflictError||error instanceof EvidenceReviewInputError?error.message:"Framework applicability could not be resolved.";redirect(`/admin/review-frameworks?error=${encodeURIComponent(message)}`);}
 redirect("/admin/review-frameworks?result=bound");
}
export async function recordFrameworkRevisionAction(form:FormData):Promise<void>{
 const principal=await requirePortalAuthorization("admin");
 try{await getEvidenceReviewFrameworkService().recordRevision(principal,{frameworkId:value(form,"frameworkId"),title:value(form,"title"),effectiveFrom:new Date(value(form,"effectiveFrom"))});}
 catch(error){const message=error instanceof EvidenceReviewConflictError||error instanceof EvidenceReviewInputError?error.message:"Framework revision could not be recorded.";redirect(`/admin/review-frameworks?error=${encodeURIComponent(message)}`);}
 redirect("/admin/review-frameworks?result=revision");
}
