import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { normalizeSecureFileReference } from "./secure-file-domain";

export const SECURE_FILE_ACCESS_SCHEMA_VERSION = 1 as const;
export const SECURE_FILE_ACCESS_TTL_SECONDS = 120 as const;
export const SECURE_FILE_ACCESS_MAX_TTL_SECONDS = 300 as const;
export const SECURE_FILE_ACCESS_PURPOSES = ["preview", "download"] as const;

export type SecureFileAccessPurpose =
  (typeof SECURE_FILE_ACCESS_PURPOSES)[number];

export type VerifiedSecureFileAccess = Readonly<{
  fileRef: string;
  purpose: SecureFileAccessPurpose;
  issuedAt: string;
  expiresAt: string;
}>;

export type IssuedSecureFileAccess = VerifiedSecureFileAccess & Readonly<{
  token: string;
}>;

export class SecureFileAccessContractError extends Error {
  constructor(message = "The secure file access contract is invalid.") {
    super(message);
    this.name = "SecureFileAccessContractError";
  }
}

export class SecureFileAccessDeniedError extends Error {
  constructor() {
    super("The secure file could not be accessed.");
    this.name = "SecureFileAccessDeniedError";
  }
}

const TOKEN_SEGMENT = /^[A-Za-z0-9_-]+$/;
const SCOPE_BINDING = /^[a-f0-9]{64}$/;
const TOKEN_CONTEXT = "hse-verify-secure-file-access-token-v1";
const SCOPE_CONTEXT = "hse-verify-secure-file-access-scope-v1";
const KEY_CONTEXT = "hse-verify-secure-file-access-key-v1";
const TOKEN_MAX_LENGTH = 2_048;
const FUTURE_CLOCK_SKEW_SECONDS = 5;

type TokenPayload = Readonly<{
  v: typeof SECURE_FILE_ACCESS_SCHEMA_VERSION;
  f: string;
  p: SecureFileAccessPurpose;
  s: string;
  iat: number;
  exp: number;
}>;

function requireSigningSecret(value: string): string {
  if (typeof value !== "string" || value.length < 32) {
    throw new SecureFileAccessContractError("Secure file signing secret is invalid.");
  }
  return value;
}

function signingKey(secretInput: string): Buffer {
  const secret = requireSigningSecret(secretInput);
  return createHmac("sha256", secret).update(KEY_CONTEXT, "utf8").digest();
}

function assertPrincipalShape(principal: AuthorizationPrincipal): void {
  if (
    !principal ||
    principal.accountStatus !== "active" ||
    typeof principal.accountId !== "string" ||
    principal.accountId.length < 1 ||
    typeof principal.sessionId !== "string" ||
    principal.sessionId.length < 1
  ) {
    throw new SecureFileAccessDeniedError();
  }
  const membership = principal.tenantMembership;
  if (principal.activeRole === "company") {
    if (
      !membership ||
      membership.status !== "active" ||
      membership.tenantStatus !== "active" ||
      membership.tenantId.length < 1 ||
      membership.membershipId.length < 1
    ) {
      throw new SecureFileAccessDeniedError();
    }
  } else if (membership !== null) {
    throw new SecureFileAccessDeniedError();
  }
}

function principalScopeBinding(
  principal: AuthorizationPrincipal,
  key: Buffer
): string {
  assertPrincipalShape(principal);
  const membership = principal.tenantMembership;
  return createHmac("sha256", key)
    .update(SCOPE_CONTEXT, "utf8")
    .update("\u0000", "utf8")
    .update(principal.sessionId, "utf8")
    .update("\u0000", "utf8")
    .update(principal.accountId, "utf8")
    .update("\u0000", "utf8")
    .update(principal.activeRole, "utf8")
    .update("\u0000", "utf8")
    .update(membership?.tenantId ?? "-", "utf8")
    .update("\u0000", "utf8")
    .update(membership?.membershipId ?? "-", "utf8")
    .digest("hex");
}

export function normalizeSecureFileAccessPurpose(
  value: unknown
): SecureFileAccessPurpose {
  if (
    typeof value !== "string" ||
    !SECURE_FILE_ACCESS_PURPOSES.includes(value as SecureFileAccessPurpose)
  ) {
    throw new SecureFileAccessContractError("Secure file access purpose is invalid.");
  }
  return value as SecureFileAccessPurpose;
}

export function normalizeSecureFileAccessRequest(value: unknown): Readonly<{
  fileRef: string;
  purpose: SecureFileAccessPurpose;
}> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new SecureFileAccessContractError("Secure file access request is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "fileRef" || keys[1] !== "purpose") {
    throw new SecureFileAccessContractError("Secure file access request schema is invalid.");
  }
  const fileRef = typeof record.fileRef === "string"
    ? normalizeSecureFileReference(record.fileRef)
    : null;
  if (!fileRef) {
    throw new SecureFileAccessContractError("Secure file reference is invalid.");
  }
  return Object.freeze({
    fileRef,
    purpose: normalizeSecureFileAccessPurpose(record.purpose)
  });
}

function encodePayload(payload: TokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function tokenSignature(encodedPayload: string, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(TOKEN_CONTEXT, "utf8")
    .update("\u0000", "utf8")
    .update(encodedPayload, "ascii")
    .digest();
}

function parseTokenPayload(encodedPayload: string): TokenPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new SecureFileAccessDeniedError();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw new SecureFileAccessDeniedError();
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 6 ||
    keys[0] !== "exp" ||
    keys[1] !== "f" ||
    keys[2] !== "iat" ||
    keys[3] !== "p" ||
    keys[4] !== "s" ||
    keys[5] !== "v"
  ) {
    throw new SecureFileAccessDeniedError();
  }
  const fileRef = typeof record.f === "string"
    ? normalizeSecureFileReference(record.f)
    : null;
  if (
    record.v !== SECURE_FILE_ACCESS_SCHEMA_VERSION ||
    !fileRef ||
    typeof record.s !== "string" ||
    !SCOPE_BINDING.test(record.s) ||
    typeof record.iat !== "number" ||
    typeof record.exp !== "number" ||
    !Number.isSafeInteger(record.iat) ||
    !Number.isSafeInteger(record.exp)
  ) {
    throw new SecureFileAccessDeniedError();
  }
  let purpose: SecureFileAccessPurpose;
  try {
    purpose = normalizeSecureFileAccessPurpose(record.p);
  } catch {
    throw new SecureFileAccessDeniedError();
  }
  return Object.freeze({
    v: SECURE_FILE_ACCESS_SCHEMA_VERSION,
    f: fileRef,
    p: purpose,
    s: record.s,
    iat: record.iat,
    exp: record.exp
  });
}

function epochSeconds(value: Date): number {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new SecureFileAccessContractError("Secure file access time is invalid.");
  }
  return Math.floor(milliseconds / 1_000);
}

export function issueSecureFileAccessToken(input: {
  principal: AuthorizationPrincipal;
  fileRef: string;
  purpose: SecureFileAccessPurpose;
  signingSecret: string;
  now?: Date;
}): IssuedSecureFileAccess {
  const fileRef = normalizeSecureFileReference(input.fileRef);
  if (!fileRef) {
    throw new SecureFileAccessContractError("Secure file reference is invalid.");
  }
  const purpose = normalizeSecureFileAccessPurpose(input.purpose);
  const key = signingKey(input.signingSecret);
  const now = input.now ?? new Date();
  const issuedAt = epochSeconds(now);
  const expiresAt = issuedAt + SECURE_FILE_ACCESS_TTL_SECONDS;
  const payload: TokenPayload = Object.freeze({
    v: SECURE_FILE_ACCESS_SCHEMA_VERSION,
    f: fileRef,
    p: purpose,
    s: principalScopeBinding(input.principal, key),
    iat: issuedAt,
    exp: expiresAt
  });
  const encodedPayload = encodePayload(payload);
  const signature = tokenSignature(encodedPayload, key).toString("base64url");
  return Object.freeze({
    token: `${encodedPayload}.${signature}`,
    fileRef,
    purpose,
    issuedAt: new Date(issuedAt * 1_000).toISOString(),
    expiresAt: new Date(expiresAt * 1_000).toISOString()
  });
}

export function verifySecureFileAccessToken(input: {
  principal: AuthorizationPrincipal;
  token: string;
  signingSecret: string;
  now?: Date;
}): VerifiedSecureFileAccess {
  if (
    typeof input.token !== "string" ||
    input.token.length < 32 ||
    input.token.length > TOKEN_MAX_LENGTH
  ) {
    throw new SecureFileAccessDeniedError();
  }
  const segments = input.token.split(".");
  if (
    segments.length !== 2 ||
    !segments[0] ||
    !segments[1] ||
    !TOKEN_SEGMENT.test(segments[0]) ||
    !TOKEN_SEGMENT.test(segments[1])
  ) {
    throw new SecureFileAccessDeniedError();
  }
  const key = signingKey(input.signingSecret);
  const providedSignature = Buffer.from(segments[1], "base64url");
  const expectedSignature = tokenSignature(segments[0], key);
  if (
    providedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new SecureFileAccessDeniedError();
  }
  const payload = parseTokenPayload(segments[0]);
  const now = epochSeconds(input.now ?? new Date());
  if (
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > SECURE_FILE_ACCESS_MAX_TTL_SECONDS ||
    payload.iat > now + FUTURE_CLOCK_SKEW_SECONDS ||
    now >= payload.exp
  ) {
    throw new SecureFileAccessDeniedError();
  }
  const expectedScope = principalScopeBinding(input.principal, key);
  const providedScope = Buffer.from(payload.s, "hex");
  const expectedScopeBytes = Buffer.from(expectedScope, "hex");
  if (
    providedScope.byteLength !== expectedScopeBytes.byteLength ||
    !timingSafeEqual(providedScope, expectedScopeBytes)
  ) {
    throw new SecureFileAccessDeniedError();
  }
  return Object.freeze({
    fileRef: payload.f,
    purpose: payload.p,
    issuedAt: new Date(payload.iat * 1_000).toISOString(),
    expiresAt: new Date(payload.exp * 1_000).toISOString()
  });
}
