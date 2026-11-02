"use server";
import {revalidatePath} from "next/cache";
import {CaseAppealEvidenceFollowupService} from "@/lib/assurance/case-appeal-evidence-followup-service";
import {redirect} from "next/navigation";
import {requirePortalAuthorization} from "@/lib/authorization/authorization-service";
import {CaseAppealService,CaseAppealConflictError,CaseAppealAccessError} from "@/lib/assurance/case-appeal-service";
function field(form:FormData,key:string){const x=form.get(key);return typeof x==="string"?x.trim():"";}
export async function submitCaseAppealAction(form:FormData):Promise<void>{
 const principal=await requirePortalAuthorization("worker");
 const caseId=field(form,"caseId"),grounds=field(form,"grounds");
 const evidenceRecordIds=form.getAll("evidenceRecordIds").filter((x):x is string=>typeof x==="string").map(x=>x.trim()).filter(Boolean);
 try{await new CaseAppealService().submit(principal,{caseId,grounds,evidenceRecordIds});}
 catch(e){
  if(e instanceof CaseAppealAccessError)redirect("/worker/case-appeals?error=unavailable");
  if(e instanceof CaseAppealConflictError)redirect("/worker/case-appeals?error=conflict");
  throw e;
 }
 revalidatePath("/worker/case-appeals");revalidatePath("/admin/case-appeals");
 redirect("/worker/case-appeals?status=submitted");
}


export async function respondCaseAppealEvidenceAction(form:FormData):Promise<void>{
 const principal=await requirePortalAuthorization("worker");
 const appealId=field(form,"appealId"),requestId=field(form,"requestId");
 const expectedVersion=Number(field(form,"expectedVersion")),reason=field(form,"reason");
 const evidenceRecordIds=form.getAll("evidenceRecordIds").filter((id):id is string=>typeof id==="string").map(id=>id.trim()).filter(Boolean);
 try{await new CaseAppealEvidenceFollowupService().respond(principal,{appealId,requestId,expectedVersion,reason,evidenceRecordIds});}
 catch(e){
  if(e instanceof CaseAppealAccessError)redirect("/worker/case-appeals?error=unavailable");
  if(e instanceof CaseAppealConflictError)redirect("/worker/case-appeals?error=conflict");
  throw e;
 }
 revalidatePath("/worker/case-appeals");revalidatePath("/admin/case-appeals");
 redirect("/worker/case-appeals?status=evidence-submitted");
}
