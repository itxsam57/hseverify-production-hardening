import { NextResponse } from "next/server";
import { readAuthenticatedSession } from "@/lib/auth/auth-session-service";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { isSameOriginRegistrationPost } from "@/lib/http/registration-request";
import { InterviewAccommodationSupportService, InterviewSupportError } from "@/lib/privacy/interview-accommodation-support";
const MAX_BYTES = 16000;
function sameOriginSupportPost(request: Request): boolean {
 const rawOrigin = request.headers.get("origin");
 if (!rawOrigin) return false;
 try {
  const browser = new URL(rawOrigin), internal = new URL(request.url), environment = getServerEnvironment();
  if (rawOrigin !== browser.origin) return false;
  if (environment.publicBaseUrl && !["development","test"].includes(environment.appEnvironment)) {
   return browser.origin === new URL(environment.publicBaseUrl).origin && isSameOriginRegistrationPost(request);
  }
  if (environment.appEnvironment === "development" || environment.appEnvironment === "test") {
   if (!["localhost","127.0.0.1","[::1]"].includes(browser.hostname) ||
       browser.protocol !== internal.protocol || browser.port !== internal.port ||
       request.headers.get("host")?.trim().toLowerCase() !== browser.host.toLowerCase()) return false;
   const validatedHeaders = new Headers(request.headers);
   validatedHeaders.delete("x-forwarded-host");validatedHeaders.delete("x-forwarded-proto");
   return isSameOriginRegistrationPost(new Request(request.url,{headers:validatedHeaders}));
  }
  // Keep the existing deployment's trusted proxy contract when no canonical origin is configured.
  return isSameOriginRegistrationPost(request);
 } catch { return false; }
}

function noStore(body: unknown, status = 200): NextResponse {
 const response = NextResponse.json(body,{status});
 response.headers.set("Cache-Control","no-store, private");
 return response;
}
function failure(error: unknown): NextResponse {
 return error instanceof InterviewSupportError ? noStore({error:error.message},error.status) : noStore({error:"Human interview support is temporarily unavailable."},503);
}
async function actor() {
 const session = await readAuthenticatedSession();
 return session ? {accountId:session.accountId,sessionId:session.sessionId,activeRole:session.role} : null;
}
export async function GET(_request: Request,{params}:{params:Promise<{interviewRequestId:string}>}): Promise<NextResponse> {
 try {
  const principal = await actor();
  if (!principal) return noStore({error:"Authentication required."},401);
  const {interviewRequestId} = await params;
  return noStore(await new InterviewAccommodationSupportService().read(principal,interviewRequestId));
 } catch(error) { return failure(error); }
}
export async function POST(request: Request,{params}:{params:Promise<{interviewRequestId:string}>}): Promise<NextResponse> {
 try {
  if (!sameOriginSupportPost(request)) return noStore({error:"Same-origin support submission is required."},403);
  const principal = await actor();
  if (!principal) return noStore({error:"Authentication required."},401);
  const reader = request.body?.getReader();
  if (!reader) return noStore({error:"Support input is required."},400);
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
   const chunk = await reader.read();
   if (chunk.done) break;
   total += chunk.value.byteLength;
   if (total > MAX_BYTES) { await reader.cancel(); return noStore({error:"Support input is too large."},413); }
   chunks.push(chunk.value);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { return noStore({error:"Support input is invalid."},400); }
  const {interviewRequestId} = await params;
  const message = await new InterviewAccommodationSupportService().publish(principal,interviewRequestId,value);
  return noStore({message},201);
 } catch(error) { return failure(error); }
}
