import { NextResponse } from "next/server";

import { readWorkerRegistrationToken } from "@/lib/auth/worker-registration-cookie";
import {
  RegistrationServiceError,
  getWorkerRegistrationService
} from "@/lib/auth/worker-registration-service";
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

  const token = await readWorkerRegistrationToken();
  if (!token) {
    return redirectTo(request, "/worker/register?reason=restart");
  }

  try {
    const service = await getWorkerRegistrationService();
    await service.resend({
      token,
      requestFingerprint: registrationRouteRequestFingerprint(request)
    });
  } catch (error) {
    if (!(error instanceof RegistrationServiceError)) throw error;
    if (error.code === "flow_missing" || error.code === "flow_expired") {
      return redirectTo(request, "/worker/register?reason=restart");
    }
    const code = error.code === "challenge_cooldown" ? "cooldown" : "unavailable";
    return redirectTo(request, `/worker/register/verify?error=${code}`);
  }

  return redirectTo(request, "/worker/register/verify?status=resent");
}
