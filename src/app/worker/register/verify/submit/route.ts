import { NextResponse } from "next/server";

import { readWorkerRegistrationChallengeBinding } from "@/lib/auth/worker-registration-challenge-binding";
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

function errorCode(error: RegistrationServiceError): string {
  switch (error.code) {
    case "invalid_code":
      return "invalid-code";
    case "challenge_expired":
      return "expired";
    case "challenge_missing":
    case "wrong_step":
      return "stale-code";
    case "flow_missing":
    case "flow_expired":
      return "restart";
    default:
      return "unavailable";
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRegistrationPost(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  const token = await readWorkerRegistrationToken();
  if (!token) {
    return redirectTo(request, "/worker/register?reason=restart");
  }

  const formData = await request.formData();
  const codeValue = formData.get("code");
  const challengeValue = formData.get("challengeId");
  const code = typeof codeValue === "string" ? codeValue.trim() : "";
  const challengeId =
    typeof challengeValue === "string" ? challengeValue.trim() : "";

  if (!/^\d{6}$/.test(code) || !/^otp_[A-Za-z0-9_-]{24}$/.test(challengeId)) {
    return redirectTo(
      request,
      "/worker/register/verify?error=invalid-format"
    );
  }

  const binding = await readWorkerRegistrationChallengeBinding(token);
  if (!binding) {
    return redirectTo(request, "/worker/register?reason=restart");
  }
  if (!binding.challengeId || binding.challengeId !== challengeId) {
    return redirectTo(request, "/worker/register/verify?error=stale-code");
  }

  let stage: "email" | "phone" | "complete";
  try {
    const service = await getWorkerRegistrationService();
    const result = await service.verify({
      token,
      code,
      requestFingerprint: registrationRouteRequestFingerprint(request)
    });
    stage =
      result.state.step === "pending_phone"
        ? "phone"
        : result.state.step === "complete"
          ? "complete"
          : "email";
  } catch (error) {
    // BUILD-PIN AUTH-REG-OTP-ERROR-BOUNDARY:
    // Only expected registration-domain failures become user-facing OTP errors.
    // Unexpected database/invariant faults must escape to the server error log;
    // hiding them as "try again" made the owner defect impossible to diagnose.
    if (!(error instanceof RegistrationServiceError)) throw error;
    const code = errorCode(error);
    if (code === "restart") {
      return redirectTo(request, "/worker/register?reason=restart");
    }
    return redirectTo(request, `/worker/register/verify?error=${code}`);
  }

  // BUILD-PIN AUTH-REG-OTP-POST:
  // The verification page is force-dynamic. A normal POST + 303 GET is enough
  // to read committed database state; do not add cache invalidation here or
  // wrap redirect infrastructure inside the verification error boundary.
  return redirectTo(request, `/worker/register/verify?stage=${stage}`);
}
