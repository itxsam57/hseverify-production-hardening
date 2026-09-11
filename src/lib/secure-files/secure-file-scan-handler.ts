import "server-only";

import { getServerEnvironment } from "../config/server-environment";
import {
  normalizeOutboxPayload,
  type OutboxHandlerResult,
  type OutboxJobRecord,
  type TrustedOutboxLease
} from "../outbox/outbox-domain";
import { createLocalTestPrivateObjectStorage } from "./private-object-storage";
import {
  MalwareScannerError,
  createLocalTestMalwareScanner
} from "./malware-scanner";
import {
  SECURE_FILE_SCAN_JOB_TYPE,
  computeSecureFileContentSha256,
  normalizeMalwareScanResult
} from "./secure-file-scan-domain";
import { DatabaseSecureFileScanRepository } from "./secure-file-scan-repository";

const FAILURE_SUMMARIES = Object.freeze({
  scanner_not_configured: "A malware scanner is not configured for this environment.",
  storage_not_configured: "Private object storage is not configured for this environment.",
  private_object_missing: "The private object required for malware scanning is missing.",
  private_object_mismatch: "The private object no longer matches accepted quarantine provenance.",
  scanner_error: "The malware scanner could not complete this attempt."
});

function terminal(code: keyof typeof FAILURE_SUMMARIES): OutboxHandlerResult {
  return Object.freeze({
    kind: "terminal" as const,
    failure: Object.freeze({ code, summary: FAILURE_SUMMARIES[code] })
  });
}

function retryable(code: "scanner_error", summary = FAILURE_SUMMARIES.scanner_error): OutboxHandlerResult {
  return Object.freeze({
    kind: "retryable" as const,
    failure: Object.freeze({ code, summary })
  });
}

export async function handleSecureFileScanJob(
  job: OutboxJobRecord,
  lease: TrustedOutboxLease
): Promise<OutboxHandlerResult> {
  if (job.jobType !== SECURE_FILE_SCAN_JOB_TYPE) {
    return terminal("scanner_not_configured");
  }
  const payload = normalizeOutboxPayload(SECURE_FILE_SCAN_JOB_TYPE, job.payload);
  const repository = new DatabaseSecureFileScanRepository();
  const file = await repository.loadForHandler(job, lease);

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
  if (
    file.lifecycleStatus !== "scan_pending" ||
    file.scanGeneration !== payload.generation ||
    file.scanJobId !== job.jobId ||
    file.byteSize === null ||
    file.contentSha256 === null
  ) {
    return terminal("private_object_mismatch");
  }

  const environment = getServerEnvironment();
  if (environment.appEnvironment !== "development" && environment.appEnvironment !== "test") {
    return terminal("scanner_not_configured");
  }

  let bytes: Uint8Array | null;
  try {
    const storage = createLocalTestPrivateObjectStorage(environment.appEnvironment);
    bytes = await storage.read(file.objectKey);
  } catch {
    return terminal("storage_not_configured");
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
    const scanner = createLocalTestMalwareScanner(environment.appEnvironment);
    result = normalizeMalwareScanResult(await scanner.scan(bytes, {
      fileRef: file.fileRef,
      generation: file.scanGeneration,
      attemptNumber: lease.attemptNumber
    }));
  } catch (error) {
    if (error instanceof MalwareScannerError) {
      return retryable("scanner_error");
    }
    throw error;
  }

  if (result.kind === "retryable") {
    return Object.freeze({
      kind: "retryable" as const,
      failure: Object.freeze({ code: result.code, summary: result.summary })
    });
  }
  if (result.kind === "terminal") {
    return Object.freeze({
      kind: "terminal" as const,
      failure: Object.freeze({ code: result.code, summary: result.summary })
    });
  }

  await repository.finalizeDecision({
    job,
    lease,
    finalStatus: result.kind === "clean" ? "available" : "unsafe",
    resultCode: result.code
  });
  return Object.freeze({ kind: "succeeded" as const });
}
