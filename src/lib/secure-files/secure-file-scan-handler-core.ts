import {
  normalizeOutboxPayload,
  type OutboxHandlerResult,
  type OutboxJobRecord,
  type TrustedOutboxLease
} from "../outbox/outbox-domain";
import type { MalwareScanner } from "./malware-scanner-core";
import {
  SECURE_FILE_SCAN_JOB_TYPE,
  computeSecureFileContentSha256,
  normalizeMalwareScanResult
} from "./secure-file-scan-domain";
import type {
  DatabaseSecureFileScanRepository,
  SecureFileScanState
} from "./secure-file-scan-repository";

export type SecureFileScanObjectReader = Readonly<{
  read(objectKey: string): Promise<Uint8Array | null>;
}>;

export type SecureFileScanHandlerDependencies = Readonly<{
  repository: Pick<DatabaseSecureFileScanRepository, "loadForHandler" | "finalizeDecision">;
  storage: SecureFileScanObjectReader;
  scanner: MalwareScanner;
}>;

const FAILURE_SUMMARIES = Object.freeze({
  private_object_missing: "The private object required for malware scanning is missing.",
  private_object_mismatch: "The private object no longer matches accepted quarantine provenance.",
  scanner_error: "The malware scanner could not complete this attempt."
});

function terminal(
  code: "private_object_missing" | "private_object_mismatch",
  summary = FAILURE_SUMMARIES[code]
): OutboxHandlerResult {
  return Object.freeze({
    kind: "terminal" as const,
    failure: Object.freeze({ code, summary })
  });
}

function retryable(
  code: string,
  summary: string
): OutboxHandlerResult {
  return Object.freeze({
    kind: "retryable" as const,
    failure: Object.freeze({ code, summary })
  });
}

function completedStateResult(file: SecureFileScanState): OutboxHandlerResult | null {
  if (file.lifecycleStatus === "available" || file.lifecycleStatus === "unsafe") {
    return Object.freeze({ kind: "succeeded" as const });
  }
  if (file.lifecycleStatus === "scan_failed") {
    return Object.freeze({
      kind: "terminal" as const,
      failure: Object.freeze({
        code: file.scanResultCode ?? "scan_failed",
        summary: "The secure file scan has already reached a failed terminal state."
      })
    });
  }
  return null;
}

export async function handleSecureFileScanJobWithDependencies(
  dependencies: SecureFileScanHandlerDependencies,
  job: OutboxJobRecord,
  lease: TrustedOutboxLease
): Promise<OutboxHandlerResult> {
  if (job.jobType !== SECURE_FILE_SCAN_JOB_TYPE) {
    return Object.freeze({
      kind: "terminal" as const,
      failure: Object.freeze({
        code: "unexpected_job_type",
        summary: "The fixed malware scan handler received an unexpected job type."
      })
    });
  }
  const payload = normalizeOutboxPayload(SECURE_FILE_SCAN_JOB_TYPE, job.payload);
  const file = await dependencies.repository.loadForHandler(job, lease);
  const completed = completedStateResult(file);
  if (completed) return completed;

  if (
    file.lifecycleStatus !== "scan_pending" ||
    file.scanGeneration !== payload.generation ||
    file.scanJobId !== job.jobId ||
    file.byteSize === null ||
    file.contentSha256 === null
  ) {
    return terminal("private_object_mismatch");
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await dependencies.storage.read(file.objectKey);
  } catch {
    return retryable("storage_error", "Private object storage could not complete this attempt.");
  }
  if (!bytes) return terminal("private_object_missing");
  if (
    bytes.byteLength !== file.byteSize ||
    computeSecureFileContentSha256(bytes) !== file.contentSha256
  ) {
    return terminal("private_object_mismatch");
  }

  let result;
  try {
    result = normalizeMalwareScanResult(await dependencies.scanner.scan(bytes, {
      fileRef: file.fileRef,
      generation: file.scanGeneration,
      attemptNumber: lease.attemptNumber
    }));
  } catch {
    return retryable("scanner_error", FAILURE_SUMMARIES.scanner_error);
  }

  if (result.kind === "retryable") {
    return retryable(result.code, result.summary);
  }
  if (result.kind === "terminal") {
    return Object.freeze({
      kind: "terminal" as const,
      failure: Object.freeze({ code: result.code, summary: result.summary })
    });
  }

  await dependencies.repository.finalizeDecision({
    job,
    lease,
    finalStatus: result.kind === "clean" ? "available" : "unsafe",
    resultCode: result.code
  });
  return Object.freeze({ kind: "succeeded" as const });
}
