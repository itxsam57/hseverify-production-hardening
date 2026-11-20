import { NextResponse, type NextRequest } from "next/server";

import {
  ROLE_LOGIN_PATHS,
  isAuthRole
} from "@/lib/auth/auth-domain";
import { authSessionCookieName } from "@/lib/auth/auth-session-cookie-name";

function portalRoleFromPath(pathname: string) {
  const role = pathname.split("/")[1];
  return isAuthRole(role) ? role : null;
}

// Previously the proxy only matched protected portal subtrees. After adding
// per-page CSP, it also sees login and registration routes; those must never
// be redirected back to themselves by the optimistic no-cookie check.
const OPTIMISTIC_PROTECTED_PORTAL_PREFIXES = [
  "/worker/dashboard", "/worker/profile", "/worker/onboarding",
  "/company/dashboard", "/company/tenant-scope",
  "/assessor/dashboard", "/verifier/dashboard",
  "/admin/dashboard", "/admin/staff", "/root/dashboard", "/root/staff"
] as const;

function isOptimisticallyProtectedPortalPath(pathname: string): boolean {
  return OPTIMISTIC_PROTECTED_PORTAL_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

// Nonce-bearing CSP is generated per document request. Next 16 reads the
// request CSP and automatically adds this nonce to its own runtime scripts.
// Do not replace this with script-src unsafe-inline: it would permit arbitrary
// inline code even on a page with an otherwise strict policy.
function nonceContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:"
  ].join("; ");
}

// This is an optimistic no-cookie redirect only. The database-backed central
// authorization service remains the authoritative session, role, permission
// and tenant boundary for every protected layout and server action.
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = nonceContentSecurityPolicy(nonce);
  const role = portalRoleFromPath(request.nextUrl.pathname);
  if (role && isOptimisticallyProtectedPortalPath(request.nextUrl.pathname) &&
      !request.cookies.has(authSessionCookieName())) {
    const loginUrl = new URL(ROLE_LOGIN_PATHS[role], request.url);
    loginUrl.searchParams.set("reason", "session-required");
    const redirect = NextResponse.redirect(loginUrl, 307);
    redirect.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return redirect;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

// Cover every rendered page and Next.js runtime document, not JSON APIs or
// static bytes. Do not omit a role login page: its inline React scripts must
// be supplied the matching request nonce to remain functional.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};
