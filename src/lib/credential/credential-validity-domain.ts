export class CredentialValidityInputError extends Error {
  constructor(message = "Credential validity configuration is invalid.") {
    super(message);
    this.name = "CredentialValidityInputError";
  }
}

export type CredentialValidityConfiguration =
  | Readonly<{ mode: "days"; days: number }>
  | Readonly<{ mode: "no_expiry" | "unspecified" }>;

export type CredentialValidityBinding = CredentialValidityConfiguration & Readonly<{
  snapshotId: string | null;
  policyVersionId: string | null;
}>;

// These fields are optional for historical policy versions. Absence means the
// duration is unspecified; it must never be interpreted as an invented default.
export function normalizeCredentialValidityPolicyFields(policy: Readonly<Record<string, unknown>>): CredentialValidityConfiguration {
  const days = policy.credentialValidityDays;
  const validity = policy.credentialValidity;
  if (days !== undefined && validity !== undefined) {
    throw new CredentialValidityInputError("Credential validity days and no-expiry configuration are mutually exclusive.");
  }
  if (days !== undefined) {
    if (typeof days !== "number" || !Number.isSafeInteger(days) || days <= 0) {
      throw new CredentialValidityInputError("Credential validity days must be a positive safe integer.");
    }
    return Object.freeze({ mode: "days", days });
  }
  if (validity !== undefined) {
    if (validity !== "no_expiry") throw new CredentialValidityInputError();
    return Object.freeze({ mode: "no_expiry" });
  }
  return Object.freeze({ mode: "unspecified" });
}

export function normalizeCredentialValidityBinding(value: unknown): CredentialValidityBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CredentialValidityInputError();
  const input = value as Record<string, unknown>;
  const { snapshotId, policyVersionId, mode } = input;
  if (snapshotId === null && policyVersionId === null) {
    if (mode !== "unspecified") throw new CredentialValidityInputError();
  } else if (typeof snapshotId !== "string" || !/^policy_snapshot_[A-Za-z0-9_-]{24}$/.test(snapshotId) ||
      typeof policyVersionId !== "string" || !/^policy_version_[A-Za-z0-9_-]{24}$/.test(policyVersionId)) {
    throw new CredentialValidityInputError("Credential validity policy binding is invalid.");
  }
  const configuration = mode === "days"
    ? normalizeCredentialValidityPolicyFields({ credentialValidityDays: input.days })
    : mode === "no_expiry" ? normalizeCredentialValidityPolicyFields({ credentialValidity: "no_expiry" })
    : mode === "unspecified" ? normalizeCredentialValidityPolicyFields({}) : null;
  if (!configuration || (mode === "days" && configuration.mode !== "days")) throw new CredentialValidityInputError();
  const allowed = mode === "days" ? ["snapshotId", "policyVersionId", "mode", "days"] : ["snapshotId", "policyVersionId", "mode"];
  if (Object.keys(input).length !== allowed.length || Object.keys(input).some(key => !allowed.includes(key))) throw new CredentialValidityInputError();
  return Object.freeze({ snapshotId: snapshotId as string | null, policyVersionId: policyVersionId as string | null, ...configuration });
}

export function credentialExpiryFromValidity(issuedAt: string, configuration: CredentialValidityConfiguration): string | null {
  const issued = new Date(issuedAt).getTime();
  if (!Number.isFinite(issued)) throw new CredentialValidityInputError("Credential validity issue timestamp is invalid.");
  if (configuration.mode !== "days") return null;
  const duration = configuration.days * 86_400_000;
  const expiry = issued + duration;
  // Storage and chronological ISO projections support the four-digit-year UTC range.
  if (!Number.isSafeInteger(duration) || !Number.isSafeInteger(expiry) || expiry < -62_167_219_200_000 || expiry > 253_402_300_799_999 || expiry <= issued) {
    throw new CredentialValidityInputError("Credential validity expiry exceeds the supported timestamp range.");
  }
  return new Date(expiry).toISOString();
}

export function derivePinnedCredentialValidity(
  snapshot: Readonly<{ snapshotId: string; policyVersionId: string; effectiveValue: unknown }> | null,
  issuedAt: string
): Readonly<{ expiresAt: string | null; validity: CredentialValidityBinding }> {
  const parsed = snapshot && typeof snapshot.effectiveValue === "string"
    ? JSON.parse(snapshot.effectiveValue) as unknown : snapshot?.effectiveValue ?? {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CredentialValidityInputError();
  const configuration = normalizeCredentialValidityPolicyFields(parsed as Record<string, unknown>);
  const validity = normalizeCredentialValidityBinding({
    snapshotId: snapshot?.snapshotId ?? null,
    policyVersionId: snapshot?.policyVersionId ?? null,
    ...configuration
  });
  return Object.freeze({ expiresAt: credentialExpiryFromValidity(issuedAt, validity), validity });
}
