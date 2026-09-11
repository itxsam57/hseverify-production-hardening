import { createIdentifier, type AuthRole } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";

export const EVIDENCE_REVIEW_KINDS=["identity","qualification","experience","employment","skill","supervisor_observation"] as const;
export const EVIDENCE_REVIEW_OUTCOMES=["APPROVED","REJECTED","CHANGES_REQUESTED"] as const;
export const EVIDENCE_REVIEW_STATUSES=["QUEUED","ASSIGNED","APPROVED","REJECTED","CHANGES_REQUESTED","SUPERSEDED","CANCELLED"] as const;
export const EVIDENCE_REVIEW_READ_PERMISSION="verification.assigned.read" as const;
export const EVIDENCE_REVIEW_DECIDE_PERMISSION="verification.assigned.decide" as const;
export type EvidenceReviewKind=(typeof EVIDENCE_REVIEW_KINDS)[number];
export type EvidenceReviewOutcome=(typeof EVIDENCE_REVIEW_OUTCOMES)[number];
export type EvidenceReviewStatus=(typeof EVIDENCE_REVIEW_STATUSES)[number];
export type EvidenceReviewPrincipal=AuthorizationPrincipal & Readonly<{activeRole:"verifier"}>;
export type EvidenceReviewTask=Readonly<{taskId:string;tenantId:string;caseId:string;workerAccountId:string;evidenceKind:EvidenceReviewKind;sourceRecordId:string;sourceVersionId:string;secureFileId:string|null;evidenceLabel:string;taskStatus:EvidenceReviewStatus;assignedVerifierAccountId:string|null;claimedAt:string|null;decidedAt:string|null;createdAt:string;updatedAt:string}>;
export class EvidenceReviewAccessError extends Error{constructor(){super("Evidence review task could not be accessed.");this.name="EvidenceReviewAccessError";}}
export class EvidenceReviewConflictError extends Error{constructor(message="Evidence review task changed or is no longer actionable."){super(message);this.name="EvidenceReviewConflictError";}}
export class EvidenceReviewInputError extends Error{constructor(message="Evidence review input is invalid."){super(message);this.name="EvidenceReviewInputError";}}
export function createReviewTaskId(){return createIdentifier("evidence_review");}
export function createReviewDecisionId(){return createIdentifier("review_decision");}
export function createReviewConflictId(){return createIdentifier("review_conflict");}
export function createSupervisorObservationId(){return createIdentifier("supervisor_observation");}
export function normalizeOutcome(value:unknown):EvidenceReviewOutcome{if(typeof value!=="string"||!EVIDENCE_REVIEW_OUTCOMES.includes(value as EvidenceReviewOutcome))throw new EvidenceReviewInputError("Unknown review outcome.");return value as EvidenceReviewOutcome;}
export function normalizeReason(value:unknown):string{if(typeof value!=="string")throw new EvidenceReviewInputError();const v=value.trim().replace(/\s+/g," ");if(v.length<5||v.length>4000)throw new EvidenceReviewInputError("A review reason between 5 and 4000 characters is required.");return v;}
export function assertVerifierPrincipal(principal:AuthorizationPrincipal):asserts principal is EvidenceReviewPrincipal{if(principal.activeRole!=="verifier"||principal.accountStatus!=="active"||principal.tenantMembership!==null)throw new EvidenceReviewAccessError();}
export function actorRole(principal:EvidenceReviewPrincipal):AuthRole{return principal.activeRole;}
