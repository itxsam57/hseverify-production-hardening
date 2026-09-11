import "server-only";

import { headers } from "next/headers";

function fingerprintFromHeaders(requestHeaders: Headers): string {
  const forwardedFor = requestHeaders
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const realIp = requestHeaders.get("x-real-ip")?.trim();
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 256) ?? "unknown";
  return `${forwardedFor || realIp || "unknown"}|${userAgent}`;
}

export async function registrationRequestFingerprint(): Promise<string> {
  return fingerprintFromHeaders(await headers());
}

export function registrationRouteRequestFingerprint(request: Request): string {
  return fingerprintFromHeaders(request.headers);
}

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function allowedRegistrationOrigins(request: Request): ReadonlySet<string> {
  const requestUrl = new URL(request.url);
  const allowedOrigins = new Set<string>([requestUrl.origin]);
  const host = request.headers.get("host")?.trim();
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const requestProto = requestUrl.protocol.slice(0, -1);
  const protocols = new Set<string>([requestProto]);
  if (forwardedProto === "http" || forwardedProto === "https") {
    protocols.add(forwardedProto);
  }

  for (const effectiveHost of [host, forwardedHost]) {
    if (!effectiveHost) continue;
    for (const protocol of protocols) {
      allowedOrigins.add(new URL(`${protocol}://${effectiveHost}`).origin);
    }
  }
  return allowedOrigins;
}

export function isSameOriginRegistrationPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return allowedRegistrationOrigins(request).has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function registrationRedirectUrl(request: Request, path: string): URL {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new Error("Registration redirect requires the validated browser origin.");
  }
  const browserOrigin = new URL(origin).origin;
  if (!allowedRegistrationOrigins(request).has(browserOrigin)) {
    throw new Error("Registration redirect origin is not authorized.");
  }
  return new URL(path, browserOrigin);
}
