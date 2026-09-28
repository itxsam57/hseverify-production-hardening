import "server-only";

import { cookies } from "next/headers";

import { createOpaqueToken, hashOpaqueValue } from "@/lib/auth/auth-domain";
import { readAuthenticationRequestMetadata } from "@/lib/auth/auth-request";
import { getServerEnvironment } from "@/lib/config/server-environment";

const COOKIE_NAME = "hse_assessment_device";
const TTL_SECONDS = 60 * 60 * 24 * 30;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    priority: "high" as const,
    maxAge: TTL_SECONDS
  };
}

function hashes(token: string, securityContext: string) {
  const environment = getServerEnvironment();
  return Object.freeze({
    deviceTokenHash: hashOpaqueValue(token, environment.authPepper, "assessment-device"),
    securityContextHash: hashOpaqueValue(
      securityContext,
      environment.authPepper,
      "assessment-security-context"
    )
  });
}

export type AssessmentAccessContext = Readonly<{
  deviceTokenHash: string;
  securityContextHash: string;
}>;

export async function ensureAssessmentAccessContext(): Promise<AssessmentAccessContext> {
  const cookieStore = await cookies();
  let token = cookieStore.get(COOKIE_NAME)?.value ?? "";
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
    token = createOpaqueToken(32);
    cookieStore.set(COOKIE_NAME, token, cookieOptions());
  }
  const metadata = await readAuthenticationRequestMetadata();
  return hashes(token, metadata.userAgent ?? "unknown-browser");
}

export async function readAssessmentAccessContext(): Promise<AssessmentAccessContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value ?? "";
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) return null;
  const metadata = await readAuthenticationRequestMetadata();
  return hashes(token, metadata.userAgent ?? "unknown-browser");
}
