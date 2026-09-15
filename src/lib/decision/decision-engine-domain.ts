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

export type DecisionAuditEvent = Readonly<{
  type: "decision.created";
  decisionId: string;
  caseId: string;
  outcome: DecisionState;
  ruleVersion: string;
}>;

export type ManualDecisionOverride = Readonly<{
  overrideId: string;
  decisionId: string;
  previousState: DecisionState;
  newState: DecisionState;
  reason: string;
  evidenceReference: string;
  confirmed: boolean;
  actorReference: string;
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
  if (!input.caseId.trim() || !input.reasonCode.trim() || !input.explanation.trim() || !input.ruleVersion.trim() || input.inputReferences.length === 0) {
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

export function toDecisionAuditEvent(decision: DecisionRecord): DecisionAuditEvent {
  return Object.freeze({
    type: "decision.created",
    decisionId: decision.decisionId,
    caseId: decision.caseId,
    outcome: decision.state,
    ruleVersion: decision.ruleVersion
  });
}

export function createManualDecisionOverride(input: {
  decisionId: string;
  previousState: DecisionState;
  newState: DecisionState;
  reason: string;
  evidenceReference: string;
  confirmed: boolean;
  actorReference: string;
  createdAt: string;
}): ManualDecisionOverride {
  if (!input.decisionId.trim() || !input.reason.trim() || !input.evidenceReference.trim() || !input.actorReference.trim() || input.confirmed !== true) {
    throw new DecisionInputError("Manual override requires decision, reason, and actor. Evidence and confirmation are also required.");
  }

  if (!DECISION_STATES.includes(input.previousState) || !DECISION_STATES.includes(input.newState)) {
    throw new DecisionInputError("Manual override contains unknown decision state.");
  }

  return Object.freeze({
    overrideId: createIdentifier("decision-override"),
    ...input
  });
}
