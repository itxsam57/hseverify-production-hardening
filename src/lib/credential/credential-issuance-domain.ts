import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { credentialExpiryFromValidity, normalizeCredentialValidityBinding, type CredentialValidityBinding } from "./credential-validity-domain";

export const CREDENTIAL_STATUSES = Object.freeze([
  "valid",
  "expired",
  "suspended",
  "revoked"
] as const);

export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export type CredentialIssueRequest = {
  workerId: string;
  qualification: string;
  issuedAt: string;
  expiresAt: string | null;
  validity?: CredentialValidityBinding;
};

export type CredentialRecord = Omit<CredentialIssueRequest, "validity"> & {
  credentialId: string;
  status: CredentialStatus;
  version: number;
  publicStatusUrl: string;
  qrPayload: string;
  signature: string;
  pdfUrl: string;
};

export type CredentialIssuancePayload = Pick<CredentialRecord,
  "credentialId" | "workerId" | "qualification" | "issuedAt" | "expiresAt" |
  "publicStatusUrl" | "qrPayload" | "pdfUrl"
>;
export type CredentialAuthentication = "authenticated" | "legacy_unverified" | "unknown_key" | "invalid";

const SIGNING_KEY_CONTEXT = "hseverify:credential-issuance:signing-key:v1";
const SIGNING_PAYLOAD_CONTEXT = "hseverify:credential-issuance:payload:v1";
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

function credentialSigningKey(signingSecret: string): Buffer {
  if (typeof signingSecret !== "string" || signingSecret.length < 32 || signingSecret.length > 512) {
    throw new Error("Credential signing secret is invalid.");
  }
  return createHmac("sha256", signingSecret).update(SIGNING_KEY_CONTEXT, "utf8").digest();
}

export function credentialSigningKeyId(signingSecret: string): string {
  return createHash("sha256").update(credentialSigningKey(signingSecret)).digest("hex").slice(0, 32);
}

export function credentialQrPayload(credentialId: string, publicStatusUrl: string, keyId?: string, validity?: CredentialValidityBinding) {
  return JSON.stringify({
    type: "hse_verify_credential",
    credentialId,
    url: publicStatusUrl,
    ...(keyId ? { signing: { version: 1, algorithm: "HMAC-SHA256", keyId } } : {}),
    ...(validity ? { validity: normalizeCredentialValidityBinding(validity) } : {})
  });
}

// Fixed field order and ISO dates make the signed issuance independent of database
// timestamp serialization. Live status/version belong to lifecycle history and are
// intentionally excluded: suspension/revocation never rewrites the original issuance.
export function canonicalCredentialIssuancePayload(credential: CredentialIssuancePayload): string {
  return JSON.stringify({
    type: "hse_verify_credential_issuance",
    version: 1,
    credentialId: credential.credentialId,
    workerId: credential.workerId,
    qualification: credential.qualification,
    issuedAt: requireDate(credential.issuedAt, "Issue date"),
    expiresAt: credential.expiresAt ? requireDate(credential.expiresAt, "Expiry date") : null,
    publicStatusUrl: credential.publicStatusUrl,
    qrPayload: credential.qrPayload,
    pdfUrl: credential.pdfUrl
  });
}

export function credentialSignature(credential: CredentialIssuancePayload, signingSecret: string): string {
  return createHmac("sha256", credentialSigningKey(signingSecret))
    .update(SIGNING_PAYLOAD_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(canonicalCredentialIssuancePayload(credential), "utf8")
    .digest("hex");
}

function equalSignature(actual: string, expected: string): boolean {
  return SIGNATURE_PATTERN.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

// Dedicated credential keys are independent of session rotation. Retained keys are
// supplied only by trusted server configuration and matched by the recorded key ID.
// Removing a key fails closed without rewriting historical issuance or lifecycle rows.
export function credentialAuthentication(credential: CredentialRecord, signingSecrets: string | readonly string[]): CredentialAuthentication {
  try {
    const qr = JSON.parse(credential.qrPayload) as Record<string, unknown>;
    if (!qr || typeof qr !== "object" || Array.isArray(qr)) return "invalid";
    if (!("signing" in qr)) {
      if (credential.qrPayload !== credentialQrPayload(credential.credentialId, credential.publicStatusUrl)) return "invalid";
      const legacyChecksum = createHash("sha256")
        .update(`${credential.credentialId}:${credential.qrPayload}`)
        .digest("hex");
      return equalSignature(credential.signature, legacyChecksum) ? "legacy_unverified" : "invalid";
    }
    const signing = qr.signing as Record<string, unknown> | null;
    if (!signing || typeof signing !== "object" || Array.isArray(signing) ||
        signing.version !== 1 || signing.algorithm !== "HMAC-SHA256" ||
        typeof signing.keyId !== "string" || !/^[a-f0-9]{32}$/.test(signing.keyId)) return "invalid";
    const validity = "validity" in qr ? normalizeCredentialValidityBinding(qr.validity) : undefined;
    if (validity && credentialExpiryFromValidity(credential.issuedAt, validity) !== credential.expiresAt) return "invalid";
    if (credential.qrPayload !== credentialQrPayload(credential.credentialId, credential.publicStatusUrl, signing.keyId, validity)) return "invalid";
    const keys = typeof signingSecrets === "string" ? [signingSecrets] : signingSecrets;
    const signingSecret = keys.find(key => credentialSigningKeyId(key) === signing.keyId);
    if (!signingSecret) return "unknown_key";
    return equalSignature(credential.signature, credentialSignature(credential, signingSecret))
      ? "authenticated" : "invalid";
  } catch {
    return "invalid";
  }
}

export function verifyCredentialSignature(credential: CredentialRecord, signingSecrets: string | readonly string[]): boolean {
  return credentialAuthentication(credential, signingSecrets) === "authenticated";
}

export function publicCredentialProjection(credential: CredentialRecord) {
  return Object.freeze({
    credentialId: credential.credentialId,
    qualification: credential.qualification,
    status: credential.status,
    issuedAt: credential.issuedAt,
    expiresAt: credential.expiresAt,
    version: credential.version
  });
}

export function credentialFromRow(row: Record<string, unknown>): CredentialRecord {
  return {
    workerId: String(row.worker_id),
    qualification: String(row.qualification),
    issuedAt: requireDate(row.issued_at instanceof Date ? row.issued_at.toISOString() : String(row.issued_at), "Issue date"),
    expiresAt: row.expires_at ? requireDate(row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at), "Expiry date") : null,
    credentialId: String(row.credential_id),
    status: row.status as CredentialStatus,
    version: Number(row.version),
    publicStatusUrl: String(row.public_status_url),
    qrPayload: String(row.qr_payload),
    signature: String(row.signature),
    pdfUrl: String(row.pdf_url)
  };
}

export type CredentialLifecycleEvent = {
  status: CredentialStatus;
  version: number;
  changedAt: string;
};

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = requireText(value, label);
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function requireDate(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return date.toISOString();
}

export function issueCredential(
  request: CredentialIssueRequest,
  sequence: string,
  signingSecret: string
): CredentialRecord {
  const credentialId = `credential_id_${requireIdentifier(sequence, "Credential sequence")}`;
  const publicStatusUrl = `/verify/result/${credentialId}`;
  const pdfUrl = `/api/credentials/${credentialId}/pdf`;
  const issuedAt = requireDate(request.issuedAt, "Issue date");
  const expiresAt = request.expiresAt ? requireDate(request.expiresAt, "Expiry date") : null;
  const validity = request.validity ? normalizeCredentialValidityBinding(request.validity) : undefined;
  if (validity && credentialExpiryFromValidity(issuedAt, validity) !== expiresAt) throw new Error("Credential validity does not match its expiry.");
  const credential = {
    workerId: requireText(request.workerId, "Worker ID"),
    qualification: requireText(request.qualification, "Qualification"),
    issuedAt,
    expiresAt,
    credentialId,
    status: "valid" as const,
    version: 1,
    publicStatusUrl,
    qrPayload: credentialQrPayload(credentialId, publicStatusUrl, credentialSigningKeyId(signingSecret), validity),
    signature: "",
    pdfUrl
  };
  credential.signature = credentialSignature(credential, signingSecret);
  return credential;
}

export function transitionCredential(
  credential: CredentialRecord,
  nextStatus: CredentialStatus,
  changedAt: string
): CredentialRecord & { history: readonly CredentialLifecycleEvent[] } {
  const normalizedChangedAt = requireDate(changedAt, "Change date");
  if (!CREDENTIAL_STATUSES.includes(nextStatus)) {
    throw new Error("Credential status is invalid.");
  }
  if (credential.status === "revoked" && nextStatus !== "revoked") {
    throw new Error("Revoked credentials cannot be reactivated.");
  }

  return Object.freeze({
    ...credential,
    status: nextStatus,
    version: credential.version + 1,
    history: Object.freeze([
      { status: credential.status, version: credential.version, changedAt: credential.issuedAt },
      { status: nextStatus, version: credential.version + 1, changedAt: normalizedChangedAt }
    ])
  });
}
