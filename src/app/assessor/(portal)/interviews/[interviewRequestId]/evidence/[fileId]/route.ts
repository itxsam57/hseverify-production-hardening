import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { InterviewConsoleContextAccessError, InterviewConsoleContextService } from "@/lib/interview/interview-console-context-service";
import { SecureFileAccessDeniedError } from "@/lib/secure-files/secure-file-access-domain";

export async function GET(_request: Request, {params}: {params: Promise<{interviewRequestId: string; fileId: string}>}) {
  const actor = await requirePlatformPermission({expectedRole:"assessor",permission:"interview.assigned.read"});
  const {interviewRequestId,fileId} = await params;
  try {
    const content = await new InterviewConsoleContextService(await getDatabaseClient()).preview(actor,interviewRequestId,fileId);
    return new Response(Uint8Array.from(content.bytes),{status:200,headers:content.headers});
  } catch (error) {
    if (error instanceof InterviewConsoleContextAccessError || error instanceof SecureFileAccessDeniedError)
      return new Response("Not found",{status:404,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    throw error;
  }
}
