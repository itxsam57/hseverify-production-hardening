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
  kind: "worker" | "credential";
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
const CREDENTIAL_ID_PATTERN = /^credential_id_[A-Za-z0-9_-]{1,96}$/;
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
export type PublicCredentialVerificationSource = {
  credentialId: string;
  qualification: string;
  status: "valid" | "expired" | "suspended" | "revoked";
  issuedAt: string;
  expiresAt: string | null;
  conditional: boolean;
  authentication: "authenticated" | "legacy_unverified";
  replaced?: boolean;
};

export function projectPublicCredentialVerification(source: PublicCredentialVerificationSource, verifiedAt: string): PublicWorkerVerificationProjection {
  const identifier = normalizePublicVerificationIdentifier(source.credentialId);
  if (!identifier || identifier.kind !== "credential") throw new Error("Public credential identifier is invalid.");
  const expiresAt = source.expiresAt ? normalizeIsoTimestamp(source.expiresAt, "Credential expiry") : null;
  return {
    kind: "credential", publicIdentifier: identifier.normalizedIdentifier,
    displayName: "HSE Verify credential", competencyTitle: source.qualification,
    status: source.replaced ? "revoked" : source.status === "valid" && expiresAt && expiresAt <= verifiedAt ? "expired" : source.status,
    issuedAt: normalizeIsoTimestamp(source.issuedAt, "Credential issue timestamp"), expiresAt,
    restrictions: [
      ...(source.replaced ? ["This issuance has been replaced. Verify the current credential shared by the Worker."] : []),
      ...(source.conditional ? ["Conditional approval: conditions apply. Request the Worker’s scoped Passport before relying on this credential."] : []),
      ...(source.authentication === "legacy_unverified"
        ? ["Legacy issuance: this record has an unauthenticated checksum. Verify the underlying assessment record before relying on it."] : [])
    ],
    verifiedAt: normalizeIsoTimestamp(verifiedAt, "Verification timestamp")
  };
}
