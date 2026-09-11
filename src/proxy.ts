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

// This is an optimistic no-cookie redirect only. The database-backed central
// authorization service remains the authoritative session, role, permission
// and tenant boundary for every protected layout and server action.
export function proxy(request: NextRequest): NextResponse {
  const role = portalRoleFromPath(request.nextUrl.pathname);
  if (!role || request.cookies.has(authSessionCookieName())) {
    return NextResponse.next();
  }

  const loginUrl = new URL(ROLE_LOGIN_PATHS[role], request.url);
  loginUrl.searchParams.set("reason", "session-required");
  return NextResponse.redirect(loginUrl, 307);
}

export const config = {
  matcher: [
    "/worker/dashboard/:path*",
    "/worker/profile/:path*",
    "/worker/onboarding/:path*",
    "/company/dashboard/:path*",
    "/company/tenant-scope/:path*",
    "/assessor/dashboard/:path*",
    "/verifier/dashboard/:path*",
    "/admin/dashboard/:path*",
    "/admin/staff/:path*",
    "/root/dashboard/:path*",
    "/root/staff/:path*"
  ]
};
