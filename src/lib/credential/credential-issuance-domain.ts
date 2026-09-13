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
};

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
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
  const credentialId = `credential_id_${sequence}`;
  const publicStatusUrl = `/verify/result/${credentialId}`;

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
    qrPayload: publicStatusUrl
  };
}
