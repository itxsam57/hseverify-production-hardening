import { NextResponse } from "next/server";

import { readCompanyRegistrationToken } from "@/lib/company/company-registration-cookie";
import {
  CompanyRegistrationServiceError,
  getCompanyRegistrationService
} from "@/lib/company/company-registration-service";
import {
  isSameOriginRegistrationPost,
  registrationRedirectUrl,
  registrationRouteRequestFingerprint
} from "@/lib/http/registration-request";

function redirectTo(request: Request, path: string): NextResponse {
  const response = NextResponse.redirect(registrationRedirectUrl(request, path), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRegistrationPost(request)) {
    return new Response("Forbidden", { status: 403 });
  }
  const token = await readCompanyRegistrationToken();
  if (!token) return redirectTo(request, "/company/register?reason=expired");
  try {
    await (await getCompanyRegistrationService()).resendEmail({
      token,
      requestFingerprint: registrationRouteRequestFingerprint(request)
    });
  } catch (error) {
    if (!(error instanceof CompanyRegistrationServiceError)) throw error;
    if (error.code === "flow_missing" || error.code === "flow_expired") {
      return redirectTo(request, "/company/register?reason=expired");
    }
    const reason = error.code === "challenge_cooldown" ? "cooldown" : "unavailable";
    return redirectTo(request, `/company/register/verify?reason=${reason}`);
  }
  return redirectTo(request, "/company/register/verify?reason=resent");
}
