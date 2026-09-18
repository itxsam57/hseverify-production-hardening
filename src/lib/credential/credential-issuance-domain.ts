import { createHash } from "node:crypto";

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
};

export type CredentialRecord = CredentialIssueRequest & {
  credentialId: string;
  status: CredentialStatus;
  version: number;
  publicStatusUrl: string;
  qrPayload: string;
  signature: string;
  pdfUrl: string;
};

export function credentialQrPayload(credentialId: string, publicStatusUrl: string) {
  return JSON.stringify({
    type: "hse_verify_credential",
    credentialId,
    url: publicStatusUrl
  });
}

export function credentialSignature(credentialId: string, qrPayload: string): string {
  return createHash("sha256")
    .update(`${credentialId}:${qrPayload}`)
    .digest("hex");
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
    issuedAt: String(row.issued_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
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
  sequence: string
): CredentialRecord {
  const credentialId = `credential_id_${requireIdentifier(sequence, "Credential sequence")}`;
  const publicStatusUrl = `/verify/result/${credentialId}`;
  const pdfUrl = `/api/credentials/${credentialId}/pdf`;

  return {
    workerId: requireText(request.workerId, "Worker ID"),
    qualification: requireText(request.qualification, "Qualification"),
    issuedAt: requireDate(request.issuedAt, "Issue date"),
    expiresAt: request.expiresAt
      ? requireDate(request.expiresAt, "Expiry date")
      : null,
    credentialId,
    status: "valid",
    version: 1,
    publicStatusUrl,
    qrPayload: credentialQrPayload(credentialId, publicStatusUrl),
    signature: credentialSignature(credentialId, credentialQrPayload(credentialId, publicStatusUrl)),
    pdfUrl
  };
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
