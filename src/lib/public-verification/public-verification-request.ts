import "server-only";

import { createHmac } from "node:crypto";
import { normalizePublicVerificationIdentifier } from "@/lib/public-verification/public-verification-domain";

export type PublicVerificationRequestMetadata = {
  ipAddress: string | null;
  userAgent: string | null;
};

const MIN_SECRET_LENGTH = 32;
const MAX_IP_LENGTH = 128;
const MAX_USER_AGENT_LENGTH = 512;
const REQUEST_CONTEXT = "hseverify:m1.12:public-request-fingerprint:v1";
const IDENTIFIER_CONTEXT = "hseverify:m1.12:public-identifier-bucket:v1";

function assertSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error("Public verification request secret is invalid.");
  }
}

function normalizeMetadataValue(
  value: string | null,
  maximumLength: number,
  label: string
): string {
  if (value === null) return "unknown";
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximumLength) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function digest(secret: string, context: string, value: string): string {
  assertSecret(secret);
  return createHmac("sha256", secret)
    .update(context, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export function publicVerificationRequestFingerprint(
  metadata: PublicVerificationRequestMetadata,
  secret: string
): string {
  const ipAddress = normalizeMetadataValue(
    metadata.ipAddress,
    MAX_IP_LENGTH,
    "Public verification IP metadata"
  );
  const userAgent = normalizeMetadataValue(
    metadata.userAgent,
    MAX_USER_AGENT_LENGTH,
    "Public verification user-agent metadata"
  );
  return digest(secret, REQUEST_CONTEXT, `${ipAddress}\n${userAgent}`);
}

export function publicVerificationIdentifierBucketKey(
  normalizedIdentifier: string,
  secret: string
): string {
  const identifier = normalizePublicVerificationIdentifier(normalizedIdentifier);
  if (!identifier || identifier.normalizedIdentifier !== normalizedIdentifier) {
    throw new Error("Public verification identifier bucket input is invalid.");
  }
  return digest(
    secret,
    IDENTIFIER_CONTEXT,
    `${identifier.kind}:${identifier.normalizedIdentifier}`
  );
}