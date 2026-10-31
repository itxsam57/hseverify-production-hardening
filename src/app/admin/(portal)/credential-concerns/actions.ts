"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { ConcernReviewAccessError,ConcernReviewConflictError,ConcernReviewInputError,getCredentialConcernReviewService } from "@/lib/credential-concerns/credential-concern-review-service";
const text=(form:FormData,name:string)=>{const value=form.get(name);return typeof value==="string"?value.trim():"";};
export async function reviewCredentialConcern(form:FormData):Promise<void>{
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const concernId=text(form,"concernId");
 if(!/^public_concern_[A-Za-z0-9_-]{24}$/.test(concernId)) redirect("/admin/credential-concerns");
 const path="/admin/credential-concerns/"+concernId;
 const version=text(form,"expectedVersion");
 let result="recorded";
 try{
 await(await getCredentialConcernReviewService()).review(principal,{concernId,expectedVersion:/^\d{1,9}$/.test(version)?Number(version):NaN,
 requestId:text(form,"requestId"),outcome:text(form,"outcome"),reason:text(form,"reason"),methods:text(form,"methods"),limitations:text(form,"limitations")});
 revalidatePath(path);revalidatePath("/admin/credential-concerns");
 }catch(error){
 if(error instanceof ConcernReviewConflictError)result="conflict";
 else if(error instanceof ConcernReviewInputError)result="invalid";
 else if(error instanceof ConcernReviewAccessError)result="unavailable";
 else throw error;
 }
 redirect(path+"?result="+result);
}
