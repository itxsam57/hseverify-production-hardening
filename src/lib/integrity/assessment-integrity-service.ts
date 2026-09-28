import "server-only";

import { createIdentifier } from "@/lib/auth/auth-domain";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import type { AssessmentAccessContext } from "@/lib/assessment-attempt/assessment-device-cookie";
import { AssessmentAttemptRepository } from "@/lib/assessment-attempt/assessment-attempt-repository";
import { normalizeAssessmentAttemptReference } from "@/lib/assessment-attempt/assessment-attempt-domain";
import { getAssessmentDeliverySettingsService } from "@/lib/assessment-generation/assessment-delivery-settings-service";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import { createIntegrityEvidenceEvent, type IntegrityEventType } from "@/lib/integrity/integrity-domain";
import { IntegrityCaptureRepository } from "@/lib/integrity/integrity-capture-repository";

export type AssessmentIntegrityPolicy = Readonly<{
  requireCamera: boolean;
  requireMicrophone: boolean;
  requireScreenShare: boolean;
  recordCamera: boolean;
  recordMicrophone: boolean;
  recordScreen: boolean;
  recordingRetentionDays: number;
  integrityFailureMode: "REVIEW" | "BLOCK";
  requireFullscreen: boolean;
}>;

export class AssessmentIntegrityAccessError extends Error {
  constructor(message = "Assessment integrity session could not be accessed.") {
    super(message);
    this.name = "AssessmentIntegrityAccessError";
  }
}

export class AssessmentIntegrityInputError extends Error {
  constructor(message = "Assessment integrity signal is invalid.") {
    super(message);
    this.name = "AssessmentIntegrityInputError";
  }
}

function assertWorker(principal: AuthorizationPrincipal): void {
  if (
    principal.activeRole !== "worker" ||
    principal.accountStatus !== "active" ||
    principal.tenantMembership !== null
  ) {
    throw new AssessmentIntegrityAccessError();
  }
}

async function assertAttemptAuthority(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  attemptId: string,
  access: AssessmentAccessContext | null
) {
  assertWorker(principal);
  const repository = new AssessmentAttemptRepository(database);
  const attempt = await repository.findOwned(principal.accountId, attemptId);
  if (!attempt || attempt.status !== "IN_PROGRESS") {
    throw new AssessmentIntegrityAccessError();
  }
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
    throw new AssessmentIntegrityAccessError(
      "Assessment integrity signals must come from the bound device context."
    );
  }
  return attempt;
}

function safeDetails(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>).slice(0, 20)) {
    if (!/^[A-Za-z0-9_.-]{1,60}$/.test(key)) continue;
    if (typeof raw === "string") output[key] = raw.slice(0, 240);
    else if (typeof raw === "boolean" || typeof raw === "number") output[key] = String(raw);
  }
  return output;
}

function eventSource(type: IntegrityEventType):
  "browser" | "camera" | "microphone" | "screen" | "network" | "device" | "candidate_report" | "provider" {
  if (type === "CAMERA_UNAVAILABLE") return "camera";
  if (type === "MIC_UNAVAILABLE" || type === "ADDITIONAL_VOICE_DETECTED") return "microphone";
  if (type === "SCREEN_UNAVAILABLE" || type === "FULLSCREEN_EXITED") return "screen";
  if (type === "CONNECTION_INTERRUPTED") return "network";
  if (type === "DEVICE_CHANGED") return "device";
  if (type === "MONITORING_PROVIDER_DEGRADED" || type === "RECORDING_FAILED") return "provider";
  return "browser";
}

export class AssessmentIntegrityService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async policy(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    access: AssessmentAccessContext | null
  ): Promise<AssessmentIntegrityPolicy> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    const database = await this.databasePromise;
    const attempt = await assertAttemptAuthority(database, principal, attemptId, access);
    const settings = await getAssessmentDeliverySettingsService().get(attempt.blueprintVersionId);
    return Object.freeze({
      requireCamera: settings.requireCamera,
      requireMicrophone: settings.requireMicrophone,
      requireScreenShare: settings.requireScreenShare,
      recordCamera: settings.recordCamera,
      recordMicrophone: settings.recordMicrophone,
      recordScreen: settings.recordScreen,
      recordingRetentionDays: settings.recordingRetentionDays,
      integrityFailureMode: settings.integrityFailureMode,
      requireFullscreen: settings.requireFullscreen
    });
  }

  async record(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    access: AssessmentAccessContext | null,
    input: {
      type: IntegrityEventType;
      occurredAt?: string;
      details?: unknown;
      providerState?: "BUILT_IN" | "EXTERNAL_READY" | "DEGRADED" | "UNAVAILABLE";
    }
  ) {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    const occurredAt = input.occurredAt?.trim() || new Date().toISOString();
    if (Number.isNaN(Date.parse(occurredAt))) {
      throw new AssessmentIntegrityInputError("Integrity timestamp is invalid.");
    }
    const providerState = input.providerState ?? "BUILT_IN";
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const attempt = await assertAttemptAuthority(tx, principal, attemptId, access);
      await tx.query(
        `INSERT INTO assessment_integrity_sessions(
           attempt_id,case_id,worker_account_id,monitoring_state,provider_state,
           started_at,last_event_at
         ) VALUES($1,$2,$3,'ACTIVE',$4,$5,$5)
         ON CONFLICT(attempt_id)
         DO UPDATE SET
           last_event_at=EXCLUDED.last_event_at,
           provider_state=EXCLUDED.provider_state`,
        [attemptId, attempt.caseId, principal.accountId, providerState, occurredAt]
      );

      const event = createIntegrityEvidenceEvent({
        eventId: createIdentifier("integrity_event"),
        attemptId,
        type: input.type,
        occurredAt,
        details: safeDetails(input.details)
      });
      await new IntegrityCaptureRepository(Promise.resolve(tx)).save(event, {
        workerAccountId: principal.accountId,
        caseId: attempt.caseId,
        source: eventSource(event.type),
        providerState
      });

      const degraded =
        event.state === "DEGRADED" ||
        providerState === "DEGRADED" ||
        providerState === "UNAVAILABLE";
      await tx.query(
        `UPDATE assessment_integrity_sessions
            SET monitoring_state=$2,
                degradation_reason=$3,
                provider_state=$4,
                last_event_at=$5
          WHERE attempt_id=$1`,
        [
          attemptId,
          event.state === "RECOVERED" ? "RECOVERED" : degraded ? "DEGRADED" : "ACTIVE",
          degraded ? event.type : null,
          providerState,
          occurredAt
        ]
      );
      return event;
    });
  }

  async stop(
    principal: AuthorizationPrincipal,
    attemptReference: string,
    access: AssessmentAccessContext | null,
    now = new Date()
  ): Promise<void> {
    const attemptId = normalizeAssessmentAttemptReference(attemptReference);
    const database = await this.databasePromise;
    await database.transaction(async (tx) => {
      await assertAttemptAuthority(tx, principal, attemptId, access);
      await tx.query(
        `UPDATE assessment_integrity_sessions
            SET monitoring_state='STOPPED',stopped_at=$2,last_event_at=$2
          WHERE attempt_id=$1 AND monitoring_state<>'STOPPED'`,
        [attemptId, now.toISOString()]
      );
    });
  }
}

let service: AssessmentIntegrityService | null = null;
export function getAssessmentIntegrityService(): AssessmentIntegrityService {
  service ??= new AssessmentIntegrityService();
  return service;
}
