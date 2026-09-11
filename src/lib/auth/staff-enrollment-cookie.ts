import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const STAFF_ENROLLMENT_COOKIE_TTL_SECONDS = 2 * 60 * 60;

function staffEnrollmentCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-hse_staff_enrollment"
    : "hse_staff_enrollment";
}

function cookieSecurity() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/staff/invite",
    priority: "high" as const
  };
}

export async function writeStaffEnrollmentToken(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(staffEnrollmentCookieName(), token, {
    ...cookieSecurity(),
    maxAge: STAFF_ENROLLMENT_COOKIE_TTL_SECONDS
  });
}

export function writeStaffEnrollmentTokenToResponse(
  response: NextResponse,
  token: string
): void {
  response.cookies.set(staffEnrollmentCookieName(), token, {
    ...cookieSecurity(),
    maxAge: STAFF_ENROLLMENT_COOKIE_TTL_SECONDS
  });
}

export async function readStaffEnrollmentToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(staffEnrollmentCookieName())?.value ?? null;
}

export async function clearStaffEnrollmentToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(staffEnrollmentCookieName(), "", {
    ...cookieSecurity(),
    maxAge: 0
  });
}
