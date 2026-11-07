import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getDatabaseClient} from "@/lib/database/database";
import {DuplicateIdentityReviewService} from "@/lib/identity/duplicate-identity-review-service";
import {EvidenceReviewAccessError} from "@/lib/review/evidence-review-domain";
import {SecureFileAccessDeniedError} from "@/lib/secure-files/secure-file-access-domain";
import {RECENT_MFA_ERROR} from "@/lib/auth/recent-mfa-service";
export async function GET(request:Request,{params}:{params:Promise<{checkId:string;identityVersionId:string}>}){
 void request;const actor=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"}),scope=await params;
 try{const content=await new DuplicateIdentityReviewService(await getDatabaseClient()).preview(actor,scope.checkId,scope.identityVersionId);return new Response(Uint8Array.from(content.bytes),{headers:content.headers});}
 catch(error){if(error instanceof EvidenceReviewAccessError||error instanceof SecureFileAccessDeniedError||(error instanceof Error&&error.message===RECENT_MFA_ERROR))return new Response("Identity evidence is unavailable. Sign in again with MFA if needed.",{status:404,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});throw error;}
}
