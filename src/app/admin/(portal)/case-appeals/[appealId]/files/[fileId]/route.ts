import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {CaseAppealService,CaseAppealAccessError} from "@/lib/assurance/case-appeal-service";
import {SecureFileAccessDeniedError} from "@/lib/secure-files/secure-file-access-domain";

export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{appealId:string;fileId:string}>}){
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const {appealId,fileId}=await params;
 try{
  const content=await new CaseAppealService().previewEvidence(principal,appealId,fileId);
  return new Response(Uint8Array.from(content.bytes),{headers:content.headers});
 }catch(error){
  if(error instanceof CaseAppealAccessError||error instanceof SecureFileAccessDeniedError)
   return new Response("Case appeal evidence is unavailable.",{
    status:404,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}
   });
  throw error;
 }
}
