import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import {
  normalizePublicVerificationIdentifier,
  type PublicVerificationIdentifierKind
} from "@/lib/public-verification/public-verification-domain";

export type PublicVerificationCapabilityPayload = {
  v: 1;
  purpose: "public-verification-result";
  identifierKind: PublicVerificationIdentifierKind;
  normalizedIdentifier: string;
  issuedAt: string;
  expiresAt: string;
};

const PURPOSE = "public-verification-result" as const;
const VERSION = 1 as const;
const CAPABILITY_LIFETIME_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MIN_TOKEN_LENGTH = 80;
const MAX_TOKEN_LENGTH = 1200;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const KEY_CONTEXT = "hseverify:m1.12:public-verification-result:v1";
const AAD = Buffer.from(`${KEY_CONTEXT}:${PURPOSE}`, "utf8");

function deriveKey(secret: string): Buffer {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error("Public verification capability secret is invalid.");
  }
  return createHash("sha256")
    .update(KEY_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

function normalizeNow(now: Date): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Public verification capability clock is invalid.");
  }
  return now;
}

function safePayload(value: unknown): PublicVerificationCapabilityPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  const expectedKeys = [
    "expiresAt",
    "identifierKind",
    "issuedAt",
    "normalizedIdentifier",
    "purpose",
    "v"
  ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return null;
  }
  if (payload.v !== VERSION || payload.purpose !== PURPOSE) return null;
  if (
    payload.identifierKind !== "worker" &&
    payload.identifierKind !== "credential"
  ) {
    return null;
  }
  if (
    typeof payload.normalizedIdentifier !== "string" ||
    typeof payload.issuedAt !== "string" ||
    typeof payload.expiresAt !== "string"
  ) {
    return null;
  }
  const identifier = normalizePublicVerificationIdentifier(
    payload.normalizedIdentifier
  );
  if (!identifier || identifier.kind !== payload.identifierKind) return null;
  return {
    v: VERSION,
    purpose: PURPOSE,
    identifierKind: payload.identifierKind,
    normalizedIdentifier: identifier.normalizedIdentifier,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt
  };
}

export function mintPublicVerificationCapability(
  input: {
    identifierKind: PublicVerificationIdentifierKind;
    normalizedIdentifier: string;
  },
  secret: string,
  now: Date = new Date()
): string {
  const clock = normalizeNow(now);
  const identifier = normalizePublicVerificationIdentifier(
    input.normalizedIdentifier
  );
  if (!identifier || identifier.kind !== input.identifierKind) {
    throw new Error("Public verification capability identifier is invalid.");
  }

  const issuedAt = clock.toISOString();
  const expiresAt = new Date(
    clock.getTime() + CAPABILITY_LIFETIME_MS
  ).toISOString();
  const payload: PublicVerificationCapabilityPayload = {
    v: VERSION,
    purpose: PURPOSE,
    identifierKind: identifier.kind,
    normalizedIdentifier: identifier.normalizedIdentifier,
    issuedAt,
    expiresAt
  };

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, authTag, ciphertext]).toString("base64url");
}

export function verifyPublicVerificationCapability(
  token: string,
  secret: string,
  now: Date = new Date()
): PublicVerificationCapabilityPayload | null {
  const clock = normalizeNow(now);
  if (
    typeof token !== "string" ||
    token.length < MIN_TOKEN_LENGTH ||
    token.length > MAX_TOKEN_LENGTH ||
    !TOKEN_PATTERN.test(token)
  ) {
    return null;
  }

  try {
    const packed = Buffer.from(token, "base64url");
    if (packed.length <= NONCE_BYTES + AUTH_TAG_BYTES) return null;
    const nonce = packed.subarray(0, NONCE_BYTES);
    const authTag = packed.subarray(NONCE_BYTES, NONCE_BYTES + AUTH_TAG_BYTES);
    const ciphertext = packed.subarray(NONCE_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString("utf8");
    if (plaintext.length > 600) return null;

    const payload = safePayload(JSON.parse(plaintext));
    if (!payload) return null;
    const issuedAt = new Date(payload.issuedAt);
    const expiresAt = new Date(payload.expiresAt);
    if (
      !Number.isFinite(issuedAt.getTime()) ||
      !Number.isFinite(expiresAt.getTime())
    ) {
      return null;
    }
    if (
      expiresAt.getTime() <= issuedAt.getTime() ||
      expiresAt.getTime() - issuedAt.getTime() > CAPABILITY_LIFETIME_MS ||
      issuedAt.getTime() > clock.getTime() + MAX_CLOCK_SKEW_MS ||
      expiresAt.getTime() < clock.getTime()
    ) {
      return null;
    }
    return {
      ...payload,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
  } catch {
    return null;
  }
}