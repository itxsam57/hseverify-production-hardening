import "server-only";

import { createHash } from "node:crypto";

import { createIdentifier } from "@/lib/auth/auth-domain";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import type { AssessmentAccessContext } from "@/lib/assessment-attempt/assessment-device-cookie";
import { AssessmentAttemptRepository } from "@/lib/assessment-attempt/assessment-attempt-repository";
import { normalizeAssessmentAttemptReference } from "@/lib/assessment-attempt/assessment-attempt-domain";
import { getAssessmentIntegrityService } from "@/lib/integrity/assessment-integrity-service";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import { getServerEnvironment } from "@/lib/config/server-environment";
import {
  createRuntimePrivateObjectStorage,
  type PrivateObjectStorage
} from "@/lib/secure-files/private-object-storage";

export type RecordingAssetSource =
  | "CAMERA"
  | "MICROPHONE"
  | "SCREEN"
  | "VIDEO_AUDIO"
  | "AUDIO_ONLY"
  | "COMPOSITE";

export type StoredRecordingAsset = Readonly<{
  recordingAssetId: string;
  status: "PROCESSING" | "AVAILABLE" | "FAILED";
  byteSize: number;
  contentSha256: string;
}>;

export class RecordingAssetInputError extends Error {
  constructor(message = "Recording segment is invalid.") {
    super(message);
    this.name = "RecordingAssetInputError";
  }
}

export class RecordingAssetAccessError extends Error {
  constructor(message = "Recording segment could not be stored.") {
    super(message);
    this.name = "RecordingAssetAccessError";
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeMime(value: string): "video/webm" | "audio/webm" | "video/mp4" | "audio/ogg" | "audio/mp4" {
  const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!["video/webm","audio/webm","video/mp4","audio/ogg","audio/mp4"].includes(normalized)) {
    throw new RecordingAssetInputError("Recording MIME type is not allowed.");
  }
  return normalized as "video/webm" | "audio/webm" | "video/mp4" | "audio/ogg" | "audio/mp4";
}

function normalizeSource(value: string): RecordingAssetSource {
  if (!["CAMERA","MICROPHONE","SCREEN","VIDEO_AUDIO","AUDIO_ONLY","COMPOSITE"].includes(value)) {
    throw new RecordingAssetInputError("Recording source is invalid.");
  }
  return value as RecordingAssetSource;
}

function normalizeIngestKey(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,120}$/.test(normalized)) {
    throw new RecordingAssetInputError("Recording ingest key is invalid.");
  }
  return normalized;
}

function normalizeTime(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RecordingAssetInputError(`${label} is invalid.`);
  return date;
}

async function assertBoundAttempt(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  attemptId: string,
  access: AssessmentAccessContext | null
) {
  if (principal.activeRole !== "worker" || principal.accountStatus !== "active" || principal.tenantMembership !== null) {
    throw new RecordingAssetAccessError();
  }
  const repository = new AssessmentAttemptRepository(database);
  const attempt = await repository.findOwned(principal.accountId, attemptId);
  if (!attempt || attempt.status !== "IN_PROGRESS") throw new RecordingAssetAccessError();
  const binding = await repository.findBinding(attemptId);
  if (
    binding &&
    (
      !access ||
      binding.workerAccountId !== principal.accountId ||
      binding.deviceTokenHash !== access.deviceTokenHash ||
      binding.securityContextHash !== access.securityContextHash
    )
  ) {
    throw new RecordingAssetAccessError("Recording must come from the bound assessment device.");
  }
  return attempt;
}

function sourceAllowed(
  source: RecordingAssetSource,
  policy: Awaited<ReturnType<ReturnType<typeof getAssessmentIntegrityService>["policy"]>>
): boolean {
  if (source === "CAMERA") return policy.recordCamera;
  if (source === "MICROPHONE" || source === "AUDIO_ONLY") return policy.recordMicrophone;
  if (source === "SCREEN") return policy.recordScreen;
  if (source === "VIDEO_AUDIO") return policy.recordCamera || policy.recordMicrophone;
  return policy.recordCamera || policy.recordMicrophone || policy.recordScreen;
}

export class RecordingAssetService {
  constructor(
    private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient(),
    private readonly storage: PrivateObjectStorage = createRuntimePrivateObjectStorage(
      getServerEnvironment().appEnvironment
    )
  ) {}

  async storeAssessmentSegment(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    access: AssessmentAccessContext | null,
    input: {
      ingestKey: string;
      source: string;
      mimeType: string;
      bytes: Uint8Array;
      startedAt: string;
      endedAt: string;
    }
  ): Promise<StoredRecordingAsset> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    const ingestKey = normalizeIngestKey(input.ingestKey);
    const source = normalizeSource(input.source);
    const mimeType = normalizeMime(input.mimeType);
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > 64 * 1024 * 1024) {
      throw new RecordingAssetInputError("Recording segment must be between 1 byte and 64 MB.");
    }
    const startedAt = normalizeTime(input.startedAt, "Recording start time");
    const endedAt = normalizeTime(input.endedAt, "Recording end time");
    if (endedAt < startedAt || endedAt.getTime() - startedAt.getTime() > 10 * 60 * 1000) {
      throw new RecordingAssetInputError("Recording segment duration is invalid.");
    }

    const policy = await getAssessmentIntegrityService().policy(principal, attemptId, access);
    if (!sourceAllowed(source, policy)) {
      throw new RecordingAssetAccessError("This assessment does not permit that recording source.");
    }

    const database = await this.databasePromise;
    const attempt = await assertBoundAttempt(database, principal, attemptId, access);
    const ingestKeyHash = sha256(`assessment-recording-ingest-v1\0${principal.accountId}\0${attemptId}\0${ingestKey}`);
    const contentSha256 = sha256(input.bytes);

    const existing = await database.query<{
      recording_asset_id: string;
      status: "PROCESSING" | "AVAILABLE" | "FAILED";
      byte_size: number | string;
      content_sha256: string;
      source: string;
    }>(
      `SELECT recording_asset_id,status,byte_size,content_sha256,source
         FROM recording_assets
        WHERE ingest_key_hash=$1
        LIMIT 1`,
      [ingestKeyHash]
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (
        row.content_sha256 !== contentSha256 ||
        Number(row.byte_size) !== input.bytes.byteLength ||
        row.source !== source
      ) {
        throw new RecordingAssetInputError("Recording ingest key was reused with different content.");
      }
      return Object.freeze({
        recordingAssetId: row.recording_asset_id,
        status: row.status,
        byteSize: Number(row.byte_size),
        contentSha256: row.content_sha256
      });
    }

    const recordingAssetId = createIdentifier("recording_asset");
    const objectKey = `secure-files/${sha256(`recording-object-v1\0${recordingAssetId}\0${contentSha256}`)}`;
    const now = new Date();
    const retentionUntil = new Date(now.getTime() + policy.recordingRetentionDays * 24 * 60 * 60 * 1000);

    await database.query(
      `INSERT INTO recording_assets(
         recording_asset_id,purpose,attempt_id,interview_request_id,case_id,tenant_id,
         worker_account_id,captured_by_account_id,source,mime_type,object_key,ingest_key_hash,
         byte_size,content_sha256,status,started_at,ended_at,retention_until,created_at
       ) VALUES($1,'ASSESSMENT_INTEGRITY',$2,NULL,$3,NULL,$4,$4,$5,$6,$7,$8,$9,$10,'PROCESSING',$11,$12,$13,$14)`,
      [
        recordingAssetId,
        attemptId,
        attempt.caseId,
        principal.accountId,
        source,
        mimeType,
        objectKey,
        ingestKeyHash,
        input.bytes.byteLength,
        contentSha256,
        startedAt.toISOString(),
        endedAt.toISOString(),
        retentionUntil.toISOString(),
        now.toISOString()
      ]
    );

    try {
      const stored = await this.storage.put(objectKey, input.bytes);
      if (stored.byteSize !== input.bytes.byteLength || stored.sha256 !== contentSha256) {
        throw new RecordingAssetInputError("Stored recording verification failed.");
      }
      await database.query(
        "UPDATE recording_assets SET status='AVAILABLE' WHERE recording_asset_id=$1 AND status='PROCESSING'",
        [recordingAssetId]
      );
      return Object.freeze({
        recordingAssetId,
        status: "AVAILABLE" as const,
        byteSize: input.bytes.byteLength,
        contentSha256
      });
    } catch (error) {
      await database.query(
        "UPDATE recording_assets SET status='FAILED' WHERE recording_asset_id=$1 AND status='PROCESSING'",
        [recordingAssetId]
      ).catch(() => undefined);
      throw error;
    }
  }

  async storeInterviewSegment(
    principal: AuthorizationPrincipal,
    interviewRequestIdInput: string,
    input: {
      ingestKey: string;
      source: string;
      mimeType: string;
      bytes: Uint8Array;
      startedAt: string;
      endedAt: string;
    }
  ): Promise<StoredRecordingAsset> {
    const interviewRequestId = interviewRequestIdInput.trim();
    if (!/^interview_request_[A-Za-z0-9_-]{24}$/.test(interviewRequestId)) {
      throw new RecordingAssetInputError("Interview request reference is invalid.");
    }
    if (
      principal.accountStatus !== "active" ||
      !["worker", "assessor"].includes(principal.activeRole)
    ) {
      throw new RecordingAssetAccessError();
    }

    const ingestKey = normalizeIngestKey(input.ingestKey);
    const source = normalizeSource(input.source);
    const mimeType = normalizeMime(input.mimeType);
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > 64 * 1024 * 1024) {
      throw new RecordingAssetInputError("Recording segment must be between 1 byte and 64 MB.");
    }
    const startedAt = normalizeTime(input.startedAt, "Recording start time");
    const endedAt = normalizeTime(input.endedAt, "Recording end time");
    if (endedAt < startedAt || endedAt.getTime() - startedAt.getTime() > 10 * 60 * 1000) {
      throw new RecordingAssetInputError("Recording segment duration is invalid.");
    }

    const database = await this.databasePromise;
    const requestResult = await database.query<{
      tenant_id: string;
      case_id: string;
      worker_account_id: string;
      assessor_account_id: string | null;
      status: string;
      recording_policy: "VIDEO_AUDIO" | "AUDIO_ONLY" | "NOTES_ONLY" | "PROHIBITED";
      recording_retention_days: number | string;
      recording_consent_required: boolean;
      recording_consented_at: string | Date | null;
      runtime_status: string | null;
    }>(
      `SELECT requests.tenant_id,requests.case_id,requests.worker_account_id,
              requests.assessor_account_id,requests.status,requests.recording_policy,
              requests.recording_retention_days,requests.recording_consent_required,
              requests.recording_consented_at,sessions.status AS runtime_status
         FROM interview_requests AS requests
         LEFT JOIN interview_runtime_sessions AS sessions
           ON sessions.interview_request_id=requests.interview_request_id
        WHERE requests.interview_request_id=$1
        LIMIT 1`,
      [interviewRequestId]
    );
    const request = requestResult.rows[0];
    if (!request) throw new RecordingAssetAccessError();

    const isWorker =
      principal.activeRole === "worker" &&
      principal.accountId === request.worker_account_id;
    const isAssessor =
      principal.activeRole === "assessor" &&
      principal.accountId === request.assessor_account_id;
    if (!isWorker && !isAssessor) {
      throw new RecordingAssetAccessError("Interview recording is limited to the assigned Worker and Assessor.");
    }
    if (request.recording_policy === "NOTES_ONLY" || request.recording_policy === "PROHIBITED") {
      throw new RecordingAssetAccessError("This interview policy does not permit recording.");
    }
    if (
      request.recording_consent_required &&
      !request.recording_consented_at
    ) {
      throw new RecordingAssetAccessError("Required interview recording consent has not been recorded.");
    }
    if (!["ACTIVE","PAUSED","TECHNICAL_HOLD","ENDED"].includes(request.runtime_status ?? "")) {
      throw new RecordingAssetAccessError("Interview recording is not open in the current runtime state.");
    }
    if (
      (request.recording_policy === "AUDIO_ONLY" && source !== "AUDIO_ONLY") ||
      (request.recording_policy === "VIDEO_AUDIO" && !["VIDEO_AUDIO","AUDIO_ONLY"].includes(source))
    ) {
      throw new RecordingAssetAccessError("Recording source does not match the interview policy.");
    }

    const ingestKeyHash = sha256(
      `interview-recording-ingest-v1\0${principal.accountId}\0${interviewRequestId}\0${ingestKey}`
    );
    const contentSha256 = sha256(input.bytes);
    const existing = await database.query<{
      recording_asset_id: string;
      status: "PROCESSING" | "AVAILABLE" | "FAILED";
      byte_size: number | string;
      content_sha256: string;
      source: string;
    }>(
      `SELECT recording_asset_id,status,byte_size,content_sha256,source
         FROM recording_assets
        WHERE ingest_key_hash=$1
        LIMIT 1`,
      [ingestKeyHash]
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (
        row.content_sha256 !== contentSha256 ||
        Number(row.byte_size) !== input.bytes.byteLength ||
        row.source !== source
      ) {
        throw new RecordingAssetInputError("Recording ingest key was reused with different content.");
      }
      return Object.freeze({
        recordingAssetId: row.recording_asset_id,
        status: row.status,
        byteSize: Number(row.byte_size),
        contentSha256: row.content_sha256
      });
    }

    const recordingAssetId = createIdentifier("recording_asset");
    const objectKey = `secure-files/${sha256(
      `interview-recording-object-v1\0${recordingAssetId}\0${contentSha256}`
    )}`;
    const now = new Date();
    const retentionDays = Number(request.recording_retention_days);
    const retentionUntil = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    await database.query(
      `INSERT INTO recording_assets(
         recording_asset_id,purpose,attempt_id,interview_request_id,case_id,tenant_id,
         worker_account_id,captured_by_account_id,source,mime_type,object_key,ingest_key_hash,
         byte_size,content_sha256,status,started_at,ended_at,retention_until,created_at
       ) VALUES($1,'INTERVIEW',NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PROCESSING',$13,$14,$15,$16)`,
      [
        recordingAssetId,
        interviewRequestId,
        request.case_id,
        request.tenant_id,
        request.worker_account_id,
        principal.accountId,
        source,
        mimeType,
        objectKey,
        ingestKeyHash,
        input.bytes.byteLength,
        contentSha256,
        startedAt.toISOString(),
        endedAt.toISOString(),
        retentionUntil.toISOString(),
        now.toISOString()
      ]
    );

    try {
      const stored = await this.storage.put(objectKey, input.bytes);
      if (stored.byteSize !== input.bytes.byteLength || stored.sha256 !== contentSha256) {
        throw new RecordingAssetInputError("Stored recording verification failed.");
      }
      await database.query(
        "UPDATE recording_assets SET status='AVAILABLE' WHERE recording_asset_id=$1 AND status='PROCESSING'",
        [recordingAssetId]
      );
      return Object.freeze({
        recordingAssetId,
        status: "AVAILABLE" as const,
        byteSize: input.bytes.byteLength,
        contentSha256
      });
    } catch (error) {
      await database.query(
        "UPDATE recording_assets SET status='FAILED' WHERE recording_asset_id=$1 AND status='PROCESSING'",
        [recordingAssetId]
      ).catch(() => undefined);
      throw error;
    }
  }

}

let service: RecordingAssetService | null = null;
export function getRecordingAssetService(): RecordingAssetService {
  service ??= new RecordingAssetService();
  return service;
}
