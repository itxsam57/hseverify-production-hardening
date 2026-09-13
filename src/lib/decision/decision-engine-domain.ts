import { createIdentifier } from "../auth/auth-domain";

export const DECISION_STATES = Object.freeze([
  "APPROVED",
  "CONDITIONALLY_APPROVED",
  "PENDING_ADDITIONAL_REVIEW",
  "ADDITIONAL_EVIDENCE_REQUIRED",
  "INTERVIEW_PENDING",
  "REASSESSMENT_REQUIRED",
  "REJECTED",
  "SUSPENDED",
  "REVOKED",
  "EXPIRED"
] as const);

export type DecisionState = (typeof DECISION_STATES)[number];

export type DecisionReason = Readonly<{
  code: string;
  explanation: string;
}>;

export type DecisionRecord = Readonly<{
  decisionId: string;
  caseId: string;
  state: DecisionState;
  reason: DecisionReason;
  ruleVersion: string;
  inputReferences: readonly string[];
  createdAt: string;
}>;

export class DecisionInputError extends Error {}

export function createDecision(input: {
  caseId: string;
  state: unknown;
  reasonCode: string;
  explanation: string;
  ruleVersion: string;
  inputReferences: string[];
  createdAt: string;
}): DecisionRecord {
  if (!input.caseId.trim() || !input.reasonCode.trim() || !input.explanation.trim() || !input.ruleVersion.trim()) {
    throw new DecisionInputError("Decision requires case, reason, and rule version.");
  }

  if (typeof input.state !== "string" || !DECISION_STATES.includes(input.state as DecisionState)) {
    throw new DecisionInputError("Unknown decision state.");
  }

  return Object.freeze({
    decisionId: createIdentifier("decision"),
    caseId: input.caseId,
    state: input.state as DecisionState,
    reason: Object.freeze({ code: input.reasonCode, explanation: input.explanation }),
    ruleVersion: input.ruleVersion,
    inputReferences: Object.freeze([...input.inputReferences]),
    createdAt: input.createdAt
  });
}
