import "server-only";

import { cookies } from "next/headers";

const REGISTRATION_COOKIE_TTL_SECONDS = 60 * 60;

function registrationCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-hse_worker_registration"
    : "hse_worker_registration";
}

function registrationCookieSecurity() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/worker/register",
    priority: "high" as const
  };
}

export async function writeWorkerRegistrationToken(
  token: string
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(registrationCookieName(), token, {
    ...registrationCookieSecurity(),
    maxAge: REGISTRATION_COOKIE_TTL_SECONDS
  });
}

export async function readWorkerRegistrationToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(registrationCookieName())?.value ?? null;
}

export async function clearWorkerRegistrationToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(registrationCookieName(), "", {
    ...registrationCookieSecurity(),
    maxAge: 0
  });
}
