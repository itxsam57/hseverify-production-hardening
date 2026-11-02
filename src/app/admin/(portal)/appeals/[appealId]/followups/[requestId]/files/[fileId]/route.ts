import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {CredentialAppealFollowupService,AppealFollowupAccessError} from "@/lib/credential/credential-appeal-followup-service";
import {SecureFileAccessDeniedError} from "@/lib/secure-files/secure-file-access-domain";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{appealId:string;requestId:string;fileId:string}>}){
 void request;const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"}),scope=await params;
 try{const content=await new CredentialAppealFollowupService().previewEvidence(principal,scope.appealId,scope.requestId,scope.fileId);return new Response(Uint8Array.from(content.bytes),{headers:content.headers});}
 catch(error){if(error instanceof AppealFollowupAccessError||error instanceof SecureFileAccessDeniedError||(error instanceof Error&&error.name==="CredentialAppealReviewAuthorizationError"))return new Response("Appeal evidence is unavailable.",{status:404,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});throw error;}
}
