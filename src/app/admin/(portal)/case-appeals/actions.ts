"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {CaseAppealService,CaseAppealConflictError,CaseAppealAccessError} from "@/lib/assurance/case-appeal-service";
import {RECENT_MFA_ERROR} from "@/lib/auth/recent-mfa-service";
const field=(form:FormData,key:string)=>{const v=form.get(key);return typeof v==="string"?v.trim():"";};
export async function reviewCaseAppealAction(form:FormData):Promise<void>{
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const appealId=field(form,"appealId"),versionText=field(form,"expectedVersion"),
 status=field(form,"status"),reason=field(form,"reason");
 const version=Number(versionText);
 if(!/^[1-9]\d*$/.test(versionText)||!Number.isSafeInteger(version)||version>2147483646)redirect("/admin/case-appeals?error=conflict");
 if(!["under_review","accepted","rejected"].includes(status))redirect("/admin/case-appeals?error=status");
 try{await new CaseAppealService().review(principal,{appealId,version,status:status as "under_review"|"accepted"|"rejected",reason});}
 catch(e){
  if(e instanceof CaseAppealConflictError)redirect("/admin/case-appeals?error=conflict");
  if(e instanceof CaseAppealAccessError)redirect("/admin/case-appeals?error=independence");
  if(e instanceof Error&&e.message===RECENT_MFA_ERROR)redirect("/admin/case-appeals?error=mfa");
  throw e;
 }
 revalidatePath("/admin/case-appeals");revalidatePath("/worker/case-appeals");
 redirect("/admin/case-appeals?status=updated");
}
