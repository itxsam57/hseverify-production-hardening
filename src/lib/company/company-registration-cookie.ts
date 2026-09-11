import "server-only";

import { cookies } from "next/headers";

const COMPANY_REGISTRATION_COOKIE_TTL_SECONDS = 60 * 60;

function cookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-hse_company_registration"
    : "hse_company_registration";
}

function cookieSecurity() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/company/register",
    priority: "high" as const
  };
}

export async function writeCompanyRegistrationToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(cookieName(), token, {
    ...cookieSecurity(),
    maxAge: COMPANY_REGISTRATION_COOKIE_TTL_SECONDS
  });
}

export async function readCompanyRegistrationToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(cookieName())?.value ?? null;
}

export async function clearCompanyRegistrationToken(): Promise<void> {
  const store = await cookies();
  store.set(cookieName(), "", {
    ...cookieSecurity(),
    maxAge: 0
  });
}
