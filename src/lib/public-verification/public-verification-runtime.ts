import "server-only";

import { headers } from "next/headers";

import { getServerEnvironment } from "@/lib/config/server-environment";
import { getDatabaseClient } from "@/lib/database/database";
import { PublicVerificationRepository } from "@/lib/public-verification/public-verification-repository";
import { publicVerificationRequestFingerprint } from "@/lib/public-verification/public-verification-request";
import { PublicVerificationService } from "@/lib/public-verification/public-verification-service";

function boundedHeader(value: string | null, maximumLength: number): string | null {
  const normalized = value
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maximumLength);
  return normalized && normalized.length > 0 ? normalized : null;
}

export function getPublicVerificationSecret(): string {
  return getServerEnvironment().sessionSecret;
}

export async function getPublicVerificationRequestRuntime(): Promise<{
  service: PublicVerificationService;
  requestFingerprint: string;
}> {
  const environment = getServerEnvironment();
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0] ?? null;
  const ipAddress = boundedHeader(
    forwardedFor ?? requestHeaders.get("x-real-ip"),
    128
  );
  const userAgent = boundedHeader(requestHeaders.get("user-agent"), 512);
  const requestFingerprint = publicVerificationRequestFingerprint(
    { ipAddress, userAgent },
    environment.sessionSecret
  );
  const database = await getDatabaseClient();
  return {
    service: new PublicVerificationService(
      new PublicVerificationRepository(database),
      environment.sessionSecret
    ),
    requestFingerprint
  };
}