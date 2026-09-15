export const APPEAL_STATUSES = Object.freeze(["submitted", "under_review", "accepted", "rejected", "withdrawn"] as const);
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export type CredentialAppeal = Readonly<{
  appealId: string;
  credentialId: string;
  workerId: string;
  reason: string;
  evidence: readonly string[];
  status: AppealStatus;
  version: number;
  createdAt: string;
}>;

function text(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function submitCredentialAppeal(input: { credentialId: string; workerId: string; reason: string; evidence?: readonly string[]; createdAt: string }, sequence: string): CredentialAppeal {
  const createdAt = new Date(input.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Appeal date is invalid.");
  return Object.freeze({
    appealId: `appeal_${sequence}`,
    credentialId: text(input.credentialId, "Credential ID"),
    workerId: text(input.workerId, "Worker ID"),
    reason: text(input.reason, "Appeal reason"),
    evidence: Object.freeze([...(input.evidence ?? [])].filter(Boolean)),
    status: "submitted",
    version: 1,
    createdAt: createdAt.toISOString()
  });
}

export function transitionCredentialAppeal(appeal: CredentialAppeal, status: AppealStatus): CredentialAppeal {
  if (!APPEAL_STATUSES.includes(status)) throw new Error("Appeal status is invalid.");
  if (appeal.status === "accepted" || appeal.status === "rejected") throw new Error("Completed appeals cannot transition.");
  return Object.freeze({ ...appeal, status, version: appeal.version + 1 });
}

export function assertIndependentReview(status: AppealStatus, reviewerId: string, workerId: string) {
  if (!reviewerId.trim()) throw new Error("Reviewer is required.");
  if (reviewerId === workerId) throw new Error("Appeal requires independent reviewer.");
  if (status === "submitted") throw new Error("Submitted appeals cannot be completed by review.");
}

export function applyCredentialOutcomeToLivingRecord(status: AppealStatus) {
  return status === "accepted" ? "review_required" : status === "rejected" ? "unchanged" : "pending";
}

export const CREDENTIAL_REVIEW_ACTIONS = Object.freeze([
  "renew",
  "suspend",
  "revoke"
] as const);

export type CredentialReviewAction = (typeof CREDENTIAL_REVIEW_ACTIONS)[number];

export function applyCredentialReviewAction(input: {
  action: CredentialReviewAction;
  currentStatus: "valid" | "expired" | "suspended" | "revoked";
  changedAt: string;
}) {
  const changedAt = new Date(input.changedAt);
  if (!Number.isFinite(changedAt.getTime())) throw new Error("Review date is invalid.");
  if (!CREDENTIAL_REVIEW_ACTIONS.includes(input.action)) throw new Error("Review action is invalid.");
  if (input.currentStatus === "revoked" && input.action !== "revoke") {
    throw new Error("Revoked credentials cannot be changed.");
  }

  const status = input.action === "renew"
    ? "valid"
    : input.action === "suspend"
      ? "suspended"
      : "revoked";
  return Object.freeze({
    status,
    action: input.action,
    changedAt: changedAt.toISOString()
  });
}
