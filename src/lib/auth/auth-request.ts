import "server-only";

import { headers } from "next/headers";

export type AuthenticationRequestMetadata = {
  fingerprint: string;
  userAgent: string | null;
  ipAddress: string | null;
};

export async function readAuthenticationRequestMetadata(): Promise<AuthenticationRequestMetadata> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const realIp = requestHeaders.get("x-real-ip")?.trim();
  const ipAddress = forwardedFor || realIp || null;
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 512) ?? null;
  return {
    fingerprint: `${ipAddress ?? "unknown"}|${userAgent ?? "unknown"}`,
    userAgent,
    ipAddress
  };
}
