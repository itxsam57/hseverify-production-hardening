import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { ConcernReviewAccessError, getCredentialConcernReviewService } from "@/lib/credential-concerns/credential-concern-review-service";
export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{concernId:string;fileId:string}>}):Promise<Response>{
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const {concernId,fileId}=await params;
 try{
 const file=await(await getCredentialConcernReviewService(true)).readEvidence(principal,concernId,fileId);
 const filename=file.filename.replace(/[\r\n"\\]/g,"_").replace(/[^\x20-\x7e]/g,"_");
 return new Response(Buffer.from(file.bytes),{headers:{"Content-Type":file.mime,"Content-Disposition":'attachment; filename="'+filename+'"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"}});
 }catch(error){
 if(error instanceof ConcernReviewAccessError)return new Response("Evidence unavailable.",{status:404,headers:{"Cache-Control":"private, no-store"}});
 throw error;
 }
}
