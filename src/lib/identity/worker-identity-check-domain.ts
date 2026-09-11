import { randomBytes } from "node:crypto";

import type { HseAppEnvironment } from "../config/environment";

export const WORKER_IDENTITY_AUTOMATED_CHECK_TYPES = [
  "document_consistency",
  "face_comparison",
  "liveness"
] as const;

export const WORKER_IDENTITY_AUTOMATED_CHECK_OUTCOMES = [
  "passed",
  "needs_review"
] as const;

export const WORKER_IDENTITY_CHECK_RUN_STATUSES = [
  "processing",
  "completed",
  "provider_unavailable",
  "failed",
  "stale"
] as const;

export type WorkerIdentityAutomatedCheckType =
  (typeof WORKER_IDENTITY_AUTOMATED_CHECK_TYPES)[number];
export type WorkerIdentityAutomatedCheckOutcome =
  (typeof WORKER_IDENTITY_AUTOMATED_CHECK_OUTCOMES)[number];
export type WorkerIdentityCheckRunStatus =
  (typeof WORKER_IDENTITY_CHECK_RUN_STATUSES)[number];

export type WorkerIdentityAutomatedCheckRequest = Readonly<{
  identityId: string;
  identityVersionId: string;
  documentType: "passport" | "national_id" | "residence_permit";
  documentEvidenceRef: string;
  profilePhotoEvidenceRef: string;
  selfieEvidenceRef: string;
}>;

export type WorkerIdentityAutomatedCheckResult = Readonly<{
  checkType: WorkerIdentityAutomatedCheckType;
  outcome: WorkerIdentityAutomatedCheckOutcome;
  resultCode: string;
}>;

export type WorkerIdentityAutomatedCheckBatch = Readonly<{
  adapterKey: "deterministic_local_test";
  results: readonly WorkerIdentityAutomatedCheckResult[];
}>;

export type WorkerIdentityCheckRunRecord = Readonly<{
  runId: string;
  identityId: string;
  identityVersionId: string;
  workerAccountId: string;
  jobId: string;
  runStatus: WorkerIdentityCheckRunStatus;
  adapterKey: "deterministic_local_test" | "unconfigured" | null;
  failureCode: string | null;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
}>;

export class WorkerIdentityCheckContractError extends Error {
  constructor(message = "The Worker identity automated-check contract is invalid.") {
    super(message);
    this.name = "WorkerIdentityCheckContractError";
  }
}

export class WorkerIdentityCheckProviderUnavailableError extends Error {
  constructor() {
    super("An approved identity verification provider is not configured for this environment.");
    this.name = "WorkerIdentityCheckProviderUnavailableError";
  }
}

export class WorkerIdentityCheckStaleVersionError extends Error {
  constructor() {
    super("The automated-check job no longer targets the current submitted identity version.");
    this.name = "WorkerIdentityCheckStaleVersionError";
  }
}

export function createWorkerIdentityCheckRunId(): string {
  return `identity_check_run_${randomBytes(18).toString("base64url")}`;
}

export function isWorkerIdentityAutomatedCheckType(
  value: unknown
): value is WorkerIdentityAutomatedCheckType {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_AUTOMATED_CHECK_TYPES.includes(
      value as WorkerIdentityAutomatedCheckType
    )
  );
}

export function isWorkerIdentityAutomatedCheckOutcome(
  value: unknown
): value is WorkerIdentityAutomatedCheckOutcome {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_AUTOMATED_CHECK_OUTCOMES.includes(
      value as WorkerIdentityAutomatedCheckOutcome
    )
  );
}

export function isWorkerIdentityCheckRunStatus(
  value: unknown
): value is WorkerIdentityCheckRunStatus {
  return (
    typeof value === "string" &&
    WORKER_IDENTITY_CHECK_RUN_STATUSES.includes(
      value as WorkerIdentityCheckRunStatus
    )
  );
}

function safeResultCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)
  ) {
    throw new WorkerIdentityCheckContractError("Automated-check result code is invalid.");
  }
  return normalized;
}

export function normalizeWorkerIdentityAutomatedCheckBatch(
  batch: WorkerIdentityAutomatedCheckBatch
): WorkerIdentityAutomatedCheckBatch {
  if (batch.adapterKey !== "deterministic_local_test") {
    throw new WorkerIdentityCheckContractError("Automated-check adapter key is invalid.");
  }
  if (!Array.isArray(batch.results) || batch.results.length !== 3) {
    throw new WorkerIdentityCheckContractError("Automated-check batch is incomplete.");
  }
  const seen = new Set<WorkerIdentityAutomatedCheckType>();
  const results = batch.results.map((result) => {
    if (
      !isWorkerIdentityAutomatedCheckType(result.checkType) ||
      !isWorkerIdentityAutomatedCheckOutcome(result.outcome) ||
      seen.has(result.checkType)
    ) {
      throw new WorkerIdentityCheckContractError("Automated-check result vocabulary is invalid.");
    }
    seen.add(result.checkType);
    return Object.freeze({
      checkType: result.checkType,
      outcome: result.outcome,
      resultCode: safeResultCode(result.resultCode)
    });
  });
  if (WORKER_IDENTITY_AUTOMATED_CHECK_TYPES.some((type) => !seen.has(type))) {
    throw new WorkerIdentityCheckContractError("Automated-check batch is incomplete.");
  }
  return Object.freeze({ adapterKey: batch.adapterKey, results: Object.freeze(results) });
}

export interface WorkerIdentityVerificationAdapter {
  readonly key: "deterministic_local_test";
  run(
    request: WorkerIdentityAutomatedCheckRequest
  ): Promise<WorkerIdentityAutomatedCheckBatch>;
}

class DeterministicLocalTestIdentityVerificationAdapter
  implements WorkerIdentityVerificationAdapter
{
  readonly key = "deterministic_local_test" as const;

  async run(
    request: WorkerIdentityAutomatedCheckRequest
  ): Promise<WorkerIdentityAutomatedCheckBatch> {
    // This adapter validates workflow contracts only. It does not claim to perform
    // biometric, liveness or document-authenticity verification. Production work
    // remains fail-closed until an approved provider is configured.
    if (
      !/^worker_identity_[A-Za-z0-9_-]{24}$/.test(request.identityId) ||
      !/^identity_version_[A-Za-z0-9_-]{24}$/.test(request.identityVersionId) ||
      !/^(passport|national_id|residence_permit)$/.test(request.documentType) ||
      !/^secure_file_[A-Za-z0-9_-]{24}$/.test(request.documentEvidenceRef) ||
      !/^secure_file_[A-Za-z0-9_-]{24}$/.test(request.profilePhotoEvidenceRef) ||
      !/^secure_file_[A-Za-z0-9_-]{24}$/.test(request.selfieEvidenceRef)
    ) {
      throw new WorkerIdentityCheckContractError("Automated-check evidence request is invalid.");
    }
    return normalizeWorkerIdentityAutomatedCheckBatch({
      adapterKey: this.key,
      results: [
        {
          checkType: "document_consistency",
          outcome: "passed",
          resultCode: "sandbox_document_contract_passed"
        },
        {
          checkType: "face_comparison",
          outcome: "needs_review",
          resultCode: "sandbox_face_requires_human_review"
        },
        {
          checkType: "liveness",
          outcome: "needs_review",
          resultCode: "sandbox_liveness_requires_live_provider"
        }
      ]
    });
  }
}

export function createWorkerIdentityVerificationAdapter(
  appEnvironment: HseAppEnvironment
): WorkerIdentityVerificationAdapter {
  if (appEnvironment === "development" || appEnvironment === "test") {
    return new DeterministicLocalTestIdentityVerificationAdapter();
  }
  throw new WorkerIdentityCheckProviderUnavailableError();
}
