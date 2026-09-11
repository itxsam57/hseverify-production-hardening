import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { hashOpaqueValue } from "../auth/auth-domain";
import { getServerEnvironment } from "../config/server-environment";
import type { CompanyWorkforceRegistrationResource } from "./company-workforce-registration-service";

const BINDING_TTL_SECONDS = 60 * 60;
const BINDING_VERSION = 1 as const;

export type CompanyWorkforceRegistrationBinding = Readonly<{
  version: typeof BINDING_VERSION;
  kind: CompanyWorkforceRegistrationResource["kind"];
  resourceId: string;
  registrationTokenHash: string | null;
  expiresAt: string;
}>;

function cookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-hse_company_workforce_registration"
    : "hse_company_workforce_registration";
}

function cookieSecurity() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/worker",
    priority: "high" as const
  };
}

function signingKey(): string {
  return getServerEnvironment().authPepper;
}

function signature(payload: string): string {
  return createHmac("sha256", signingKey())
    .update("hse-company-workforce-registration-v1\n")
    .update(payload)
    .digest("base64url");
}

function encode(binding: CompanyWorkforceRegistrationBinding): string {
  const payload = Buffer.from(JSON.stringify(binding), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function decode(value: string): CompanyWorkforceRegistrationBinding | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;
  const payload = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  if (!safeEqual(suppliedSignature, signature(payload))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<CompanyWorkforceRegistrationBinding>;
  if (
    candidate.version !== BINDING_VERSION ||
    (candidate.kind !== "invitation" && candidate.kind !== "code") ||
    typeof candidate.resourceId !== "string" ||
    candidate.resourceId.length < 1 ||
    (candidate.registrationTokenHash !== null &&
      typeof candidate.registrationTokenHash !== "string") ||
    typeof candidate.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    Date.parse(candidate.expiresAt) <= Date.now()
  ) {
    return null;
  }
  return Object.freeze({
    version: BINDING_VERSION,
    kind: candidate.kind,
    resourceId: candidate.resourceId,
    registrationTokenHash: candidate.registrationTokenHash,
    expiresAt: candidate.expiresAt
  });
}

async function writeBinding(
  resource: CompanyWorkforceRegistrationResource,
  registrationTokenHash: string | null
): Promise<void> {
  const expiresAt = new Date(Date.now() + BINDING_TTL_SECONDS * 1000).toISOString();
  const binding: CompanyWorkforceRegistrationBinding = Object.freeze({
    version: BINDING_VERSION,
    kind: resource.kind,
    resourceId: resource.resourceId,
    registrationTokenHash,
    expiresAt
  });
  const cookieStore = await cookies();
  cookieStore.set(cookieName(), encode(binding), {
    ...cookieSecurity(),
    maxAge: BINDING_TTL_SECONDS
  });
}

export async function prepareCompanyWorkforceRegistrationBinding(
  resource: CompanyWorkforceRegistrationResource
): Promise<void> {
  await writeBinding(resource, null);
}

export async function bindCompanyWorkforceRegistrationToToken(
  resource: CompanyWorkforceRegistrationResource,
  registrationToken: string
): Promise<void> {
  const registrationTokenHash = hashOpaqueValue(
    registrationToken,
    getServerEnvironment().authPepper,
    "worker-registration-flow"
  );
  await writeBinding(resource, registrationTokenHash);
}

export async function readCompanyWorkforceRegistrationBinding(): Promise<CompanyWorkforceRegistrationBinding | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(cookieName())?.value;
  return raw ? decode(raw) : null;
}

export async function clearCompanyWorkforceRegistrationBinding(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(cookieName(), "", {
    ...cookieSecurity(),
    maxAge: 0
  });
}
