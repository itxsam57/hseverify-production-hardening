export const PUBLIC_VERIFICATION_STATUSES = Object.freeze([
  "valid",
  "expired",
  "suspended",
  "revoked",
  "not_found_or_invalid",
  "temporarily_unavailable"
] as const);

export type PublicVerificationStatus =
  (typeof PUBLIC_VERIFICATION_STATUSES)[number];

export type PublicVerificationIdentifierKind = "worker" | "credential";

export type PublicVerificationIdentifier = {
  kind: PublicVerificationIdentifierKind;
  normalizedIdentifier: string;
};

export type PublicWorkerVerificationSource = {
  permanentWorkerId: string;
  lifecycleStatus: string;
  legalFirstName: string;
  legalLastName: string;
  issuedAt: string;
};

export type PublicWorkerVerificationProjection = {
  kind: "worker";
  publicIdentifier: string;
  displayName: string;
  status: PublicVerificationStatus;
  issuedAt: string | null;
  expiresAt: string | null;
  competencyTitle: string | null;
  restrictions: readonly string[];
  verifiedAt: string;
};

const WORKER_ID_PATTERN = /^worker_id_[A-Za-z0-9_-]{24}$/;
const CREDENTIAL_ID_PATTERN = /^credential_id_[A-Za-z0-9_-]{24}$/;
const MAX_PUBLIC_IDENTIFIER_LENGTH = 180;
const MAX_PUBLIC_NAME_PART_LENGTH = 120;

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function normalizePublicNamePart(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < 1 ||
    normalized.length > MAX_PUBLIC_NAME_PART_LENGTH ||
    hasControlCharacters(normalized)
  ) {
    throw new Error("Public Worker display name is invalid.");
  }
  return normalized;
}

function normalizeIsoTimestamp(value: string, label: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return timestamp.toISOString();
}

export function normalizePublicVerificationIdentifier(
  raw: string
): PublicVerificationIdentifier | null {
  if (typeof raw !== "string" || raw.length > MAX_PUBLIC_IDENTIFIER_LENGTH) {
    return null;
  }
  const value = raw.trim();
  if (WORKER_ID_PATTERN.test(value)) {
    return { kind: "worker", normalizedIdentifier: value };
  }
  if (CREDENTIAL_ID_PATTERN.test(value)) {
    return { kind: "credential", normalizedIdentifier: value };
  }
  return null;
}

export function mapWorkerIdentityStatusToPublicStatus(
  status: string
): PublicVerificationStatus {
  switch (status) {
    case "verified":
    case "reinstated":
      return "valid";
    case "expired_document":
      return "expired";
    case "suspended":
      return "suspended";
    default:
      return "not_found_or_invalid";
  }
}

export function projectPublicWorkerVerification(
  source: PublicWorkerVerificationSource,
  verifiedAt: string
): PublicWorkerVerificationProjection {
  const identifier = normalizePublicVerificationIdentifier(
    source.permanentWorkerId
  );
  if (!identifier || identifier.kind !== "worker") {
    throw new Error("Public Worker identifier is invalid.");
  }

  const firstName = normalizePublicNamePart(source.legalFirstName);
  const lastName = normalizePublicNamePart(source.legalLastName);

  return {
    kind: "worker",
    publicIdentifier: identifier.normalizedIdentifier,
    displayName: `${firstName} ${lastName}`,
    status: mapWorkerIdentityStatusToPublicStatus(source.lifecycleStatus),
    issuedAt: normalizeIsoTimestamp(source.issuedAt, "Worker ID issue timestamp"),
    expiresAt: null,
    competencyTitle: null,
    restrictions: Object.freeze([]) as readonly string[],
    verifiedAt: normalizeIsoTimestamp(verifiedAt, "Verification timestamp")
  };
}