export class CredentialAppealReviewAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialAppealReviewAuthorizationError";
  }
}

export const APPEAL_STATUSES = Object.freeze(["submitted", "under_review", "accepted", "rejected", "withdrawn"] as const);
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const APPEAL_OUTCOME_ACTIONS = Object.freeze([
  "none",
  "reassessment",
  "renew",
  "suspend",
  "revoke"
] as const);
export type AppealOutcomeAction = (typeof APPEAL_OUTCOME_ACTIONS)[number];

export type CredentialAppeal = Readonly<{
  appealId: string;
  credentialId: string;
  workerId: string;
  reason: string;
  evidence: readonly string[];
  status: AppealStatus;
  version: number;
  createdAt: string;
  reviewerAccountId: string | null;
  reviewReason: string | null;
  outcomeAction: AppealOutcomeAction | null;
  reviewedAt: string | null;
}>;

function text(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function iso(value: string, label: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

export function submitCredentialAppeal(input: {
  credentialId: string;
  workerId: string;
  reason: string;
  evidence?: readonly string[];
  createdAt: string;
}, sequence: string): CredentialAppeal {
  const createdAt = iso(input.createdAt, "Appeal date");
  return Object.freeze({
    appealId: `appeal_${text(sequence, "Appeal sequence")}`,
    credentialId: text(input.credentialId, "Credential ID"),
    workerId: text(input.workerId, "Worker ID"),
    reason: text(input.reason, "Appeal reason"),
    evidence: Object.freeze([...(input.evidence ?? [])].map((item) => item.trim()).filter(Boolean)),
    status: "submitted",
    version: 1,
    createdAt,
    reviewerAccountId: null,
    reviewReason: null,
    outcomeAction: null,
    reviewedAt: null
  });
}

export function transitionCredentialAppeal(
  appeal: CredentialAppeal,
  status: AppealStatus
): CredentialAppeal {
  if (!APPEAL_STATUSES.includes(status)) throw new Error("Appeal status is invalid.");
  if (appeal.status === "accepted" || appeal.status === "rejected" || appeal.status === "withdrawn") {
    throw new Error("Completed appeals cannot transition.");
  }
  return Object.freeze({ ...appeal, status, version: appeal.version + 1 });
}

export function assertIndependentReview(status: AppealStatus, reviewerId: string, workerId: string) {
  if (!reviewerId.trim()) throw new Error("Reviewer is required.");
  if (reviewerId === workerId) throw new Error("Appeal requires independent reviewer.");
  if (status === "submitted" || status === "withdrawn") {
    throw new Error("Appeal review status is invalid.");
  }
}

export function reviewCredentialAppeal(
  appeal: CredentialAppeal,
  input: {
    status: "under_review" | "accepted" | "rejected";
    reviewerId: string;
    reason: string;
    outcomeAction?: AppealOutcomeAction;
    reviewedAt: string;
  }
): CredentialAppeal {
  assertIndependentReview(input.status, input.reviewerId, appeal.workerId);
  const reason = text(input.reason, "Appeal review reason");
  const reviewedAt = iso(input.reviewedAt, "Appeal review date");
  const outcomeAction = input.status === "accepted"
    ? (input.outcomeAction ?? "none")
    : "none";
  if (!APPEAL_OUTCOME_ACTIONS.includes(outcomeAction)) {
    throw new Error("Appeal outcome action is invalid.");
  }
  const transitioned = transitionCredentialAppeal(appeal, input.status);
  return Object.freeze({
    ...transitioned,
    reviewerAccountId: text(input.reviewerId, "Reviewer"),
    reviewReason: reason,
    outcomeAction,
    reviewedAt
  });
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