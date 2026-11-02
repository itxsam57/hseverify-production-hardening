"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requirePortalAuthorization} from "@/lib/authorization/authorization-service";
import {CaseAppealService,CaseAppealConflictError,CaseAppealAccessError} from "@/lib/assurance/case-appeal-service";
function field(form:FormData,key:string){const x=form.get(key);return typeof x==="string"?x.trim():"";}
export async function submitCaseAppealAction(form:FormData):Promise<void>{
 const principal=await requirePortalAuthorization("worker");
 const caseId=field(form,"caseId"),grounds=field(form,"grounds");
 try{await new CaseAppealService().submit(principal,{caseId,grounds});}
 catch(e){
  if(e instanceof CaseAppealAccessError)redirect("/worker/case-appeals?error=unavailable");
  if(e instanceof CaseAppealConflictError)redirect("/worker/case-appeals?error=conflict");
  throw e;
 }
 revalidatePath("/worker/case-appeals");revalidatePath("/admin/case-appeals");
 redirect("/worker/case-appeals?status=submitted");
}
