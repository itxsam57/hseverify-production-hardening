import "server-only";

import { cookies } from "next/headers";

const RECOVERY_COOKIE_TTL_SECONDS = 20 * 60;

function recoveryCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-hse_recovery"
    : "hse_recovery";
}

function cookieSecurity() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/auth/recover",
    priority: "high" as const
  };
}

export async function writeRecoveryToken(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(recoveryCookieName(), token, {
    ...cookieSecurity(),
    maxAge: RECOVERY_COOKIE_TTL_SECONDS
  });
}

export async function readRecoveryToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(recoveryCookieName())?.value ?? null;
}

export async function clearRecoveryToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(recoveryCookieName(), "", {
    ...cookieSecurity(),
    maxAge: 0
  });
}
