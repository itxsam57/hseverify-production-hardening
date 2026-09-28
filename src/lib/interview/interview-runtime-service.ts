import "server-only";

import { createIdentifier } from "@/lib/auth/auth-domain";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";

export type InterviewRuntimeStatus =
  | "CLAIMED"
  | "WAITING_ROOM"
  | "READY"
  | "ADMITTED"
  | "ACTIVE"
  | "PAUSED"
  | "ENDED"
  | "NO_SHOW"
  | "TECHNICAL_HOLD";

export type InterviewRuntimeView = Readonly<{
  interviewRequestId: string;
  interviewSessionId: string | null;
  status: InterviewRuntimeStatus | null;
  recordingPolicy: "VIDEO_AUDIO" | "AUDIO_ONLY" | "NOTES_ONLY" | "PROHIBITED";
  recordingRetentionDays: number;
  recordingConsentRequired: boolean;
  recordingConsentedAt: string | null;
  workerReadyAt: string | null;
  claimedAt: string | null;
  admittedAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
  technicalIssue: string | null;
}>;

export class InterviewRuntimeAccessError extends Error {
  constructor(message = "Interview runtime access is denied.") {
    super(message);
    this.name = "InterviewRuntimeAccessError";
  }
}

export class InterviewRuntimeConflictError extends Error {
  constructor(message = "Interview runtime state changed. Reload and try again.") {
    super(message);
    this.name = "InterviewRuntimeConflictError";
  }
}

export class InterviewRuntimeInputError extends Error {
  constructor(message = "Interview runtime input is invalid.") {
    super(message);
    this.name = "InterviewRuntimeInputError";
  }
}

type RequestRow = {
  interview_request_id: string;
  tenant_id: string;
  case_id: string;
  worker_account_id: string;
  assessor_account_id: string | null;
  status: string;
  scheduled_at: string | Date | null;
  recording_policy: InterviewRuntimeView["recordingPolicy"];
  recording_retention_days: number | string;
  recording_consent_required: boolean;
  recording_consented_at: string | Date | null;
  ready_at: string | Date | null;
  no_show_at: string | Date | null;
  technical_issue: string | null;
};

type SessionRow = {
  interview_session_id: string;
  status: InterviewRuntimeStatus;
  claimed_at: string | Date | null;
  worker_ready_at: string | Date | null;
  admitted_at: string | Date | null;
  started_at: string | Date | null;
  paused_at: string | Date | null;
  ended_at: string | Date | null;
};

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function reason(value: string, label: string, min = 5, max = 2000): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < min || normalized.length > max) {
    throw new InterviewRuntimeInputError(`${label} must contain between ${min} and ${max} characters.`);
  }
  return normalized;
}

async function requestForUpdate(
  database: DatabaseClient,
  interviewRequestId: string
): Promise<RequestRow> {
  const result = await database.query<RequestRow>(
    `SELECT interview_request_id,tenant_id,case_id,worker_account_id,assessor_account_id,
            status,scheduled_at,recording_policy,recording_retention_days,
            recording_consent_required,recording_consented_at,ready_at,no_show_at,technical_issue
       FROM interview_requests
      WHERE interview_request_id=$1
      FOR UPDATE`,
    [interviewRequestId]
  );
  const row = result.rows[0];
  if (!row) throw new InterviewRuntimeAccessError();
  return row;
}

async function sessionForUpdate(
  database: DatabaseClient,
  interviewRequestId: string
): Promise<SessionRow | null> {
  const result = await database.query<SessionRow>(
    `SELECT interview_session_id,status,claimed_at,worker_ready_at,admitted_at,
            started_at,paused_at,ended_at
       FROM interview_runtime_sessions
      WHERE interview_request_id=$1
      FOR UPDATE`,
    [interviewRequestId]
  );
  return result.rows[0] ?? null;
}

function assertParticipant(principal: AuthorizationPrincipal, request: RequestRow): "worker" | "assessor" {
  if (principal.accountStatus !== "active") throw new InterviewRuntimeAccessError();
  if (principal.activeRole === "worker" && principal.accountId === request.worker_account_id) return "worker";
  if (
    principal.activeRole === "assessor" &&
    principal.accountId === request.assessor_account_id
  ) return "assessor";
  throw new InterviewRuntimeAccessError();
}

async function insertEvent(
  database: DatabaseClient,
  sessionId: string,
  actorAccountId: string,
  eventType:
    | "CLAIMED"
    | "WORKER_READY"
    | "ADMITTED"
    | "STARTED"
    | "PAUSED"
    | "RESUMED"
    | "TECHNICAL_ISSUE"
    | "NO_SHOW"
    | "ENDED"
    | "RECORDING_STARTED"
    | "RECORDING_STOPPED",
  now: Date,
  reasonValue?: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await database.query(
    `INSERT INTO interview_runtime_events(
       event_id,interview_session_id,event_type,actor_account_id,reason,metadata,occurred_at
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      createIdentifier("interview_event"),
      sessionId,
      eventType,
      actorAccountId,
      reasonValue ?? null,
      JSON.stringify(metadata),
      now.toISOString()
    ]
  );
}

async function ensureWaitingRoomSession(
  database: DatabaseClient,
  request: RequestRow,
  now: Date
): Promise<SessionRow> {
  const existing = await sessionForUpdate(database, request.interview_request_id);
  if (existing) return existing;
  if (!request.assessor_account_id) {
    throw new InterviewRuntimeConflictError("An Assessor must be assigned before the waiting room can open.");
  }
  const draft = await database.query<{ interview_session_id: string }>(
    `SELECT interview_session_id
       FROM interview_console_drafts
      WHERE tenant_id=$1 AND interview_request_id=$2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [request.tenant_id, request.interview_request_id]
  );
  const candidateSessionId = draft.rows[0]?.interview_session_id?.trim() ?? "";
  const sessionId = /^interview_session_[A-Za-z0-9_-]{24}$/.test(candidateSessionId)
    ? candidateSessionId
    : createIdentifier("interview_session");
  await database.query(
    `INSERT INTO interview_runtime_sessions(
       interview_session_id,tenant_id,interview_request_id,worker_account_id,
       assessor_account_id,status,claimed_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'WAITING_ROOM',NULL,$6)`,
    [
      sessionId,
      request.tenant_id,
      request.interview_request_id,
      request.worker_account_id,
      request.assessor_account_id,
      now.toISOString()
    ]
  );
  return {
    interview_session_id: sessionId,
    status: "WAITING_ROOM",
    claimed_at: null,
    worker_ready_at: null,
    admitted_at: null,
    started_at: null,
    paused_at: null,
    ended_at: null
  };
}

async function readView(database: DatabaseClient, interviewRequestId: string): Promise<InterviewRuntimeView> {
  const result = await database.query<RequestRow & Partial<SessionRow>>(
    `SELECT requests.interview_request_id,requests.tenant_id,requests.case_id,
            requests.worker_account_id,requests.assessor_account_id,requests.status,
            requests.scheduled_at,requests.recording_policy,requests.recording_retention_days,
            requests.recording_consent_required,requests.recording_consented_at,
            requests.ready_at,requests.no_show_at,requests.technical_issue,
            sessions.interview_session_id,sessions.status AS runtime_status,
            sessions.claimed_at,sessions.worker_ready_at,sessions.admitted_at,
            sessions.started_at,sessions.paused_at,sessions.ended_at
       FROM interview_requests AS requests
       LEFT JOIN interview_runtime_sessions AS sessions
         ON sessions.interview_request_id=requests.interview_request_id
      WHERE requests.interview_request_id=$1
      LIMIT 1`,
    [interviewRequestId]
  );
  const row = result.rows[0] as (RequestRow & {
    interview_session_id?: string | null;
    runtime_status?: InterviewRuntimeStatus | null;
    claimed_at?: string | Date | null;
    worker_ready_at?: string | Date | null;
    admitted_at?: string | Date | null;
    started_at?: string | Date | null;
    paused_at?: string | Date | null;
    ended_at?: string | Date | null;
  }) | undefined;
  if (!row) throw new InterviewRuntimeAccessError();
  return Object.freeze({
    interviewRequestId: row.interview_request_id,
    interviewSessionId: row.interview_session_id ?? null,
    status: row.runtime_status ?? null,
    recordingPolicy: row.recording_policy,
    recordingRetentionDays: Number(row.recording_retention_days),
    recordingConsentRequired: Boolean(row.recording_consent_required),
    recordingConsentedAt: iso(row.recording_consented_at),
    workerReadyAt: iso(row.worker_ready_at ?? row.ready_at),
    claimedAt: iso(row.claimed_at ?? null),
    admittedAt: iso(row.admitted_at ?? null),
    startedAt: iso(row.started_at ?? null),
    pausedAt: iso(row.paused_at ?? null),
    endedAt: iso(row.ended_at ?? null),
    technicalIssue: row.technical_issue
  });
}

export class InterviewRuntimeService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async view(
    principal: AuthorizationPrincipal,
    interviewRequestId: string
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    const request = await requestForUpdate(database, interviewRequestId);
    assertParticipant(principal, request);
    return readView(database, interviewRequestId);
  }

  async enterWaitingRoom(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "worker") throw new InterviewRuntimeAccessError();
      if (!request.scheduled_at || !["ASSIGNED","WAITING_ROOM"].includes(request.status)) {
        throw new InterviewRuntimeConflictError("This interview is not ready for the waiting room.");
      }
      if (request.status === "ASSIGNED") {
        await tx.query(
          "UPDATE interview_requests SET status='WAITING_ROOM' WHERE interview_request_id=$1 AND status='ASSIGNED'",
          [interviewRequestId]
        );
      }
      await ensureWaitingRoomSession(tx, request, now);
      return readView(tx, interviewRequestId);
    });
  }

  async markWorkerReady(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    input: {
      cameraReady: boolean;
      microphoneReady: boolean;
      connectionReady: boolean;
      identityConfirmed: boolean;
      recordingConsent: boolean;
    },
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "worker") throw new InterviewRuntimeAccessError();
      if (!input.cameraReady || !input.microphoneReady || !input.connectionReady || !input.identityConfirmed) {
        throw new InterviewRuntimeInputError("Camera, microphone, connection and identity checks must pass before Ready.");
      }
      if (request.recording_consent_required && !input.recordingConsent) {
        throw new InterviewRuntimeInputError("Recording consent is required by the current interview policy.");
      }
      const session = await ensureWaitingRoomSession(tx, request, now);
      if (!["WAITING_ROOM","CLAIMED","READY"].includes(session.status)) {
        throw new InterviewRuntimeConflictError("Interview is no longer in the waiting room.");
      }
      const updated = await tx.query(
        `UPDATE interview_runtime_sessions
            SET status='READY',worker_ready_at=$2,updated_at=$2
          WHERE interview_request_id=$1
            AND status IN ('WAITING_ROOM','CLAIMED','READY')`,
        [interviewRequestId, now.toISOString()]
      );
      if (updated.affectedRows !== 1) throw new InterviewRuntimeConflictError();
      await tx.query(
        `UPDATE interview_requests
            SET ready_at=$2,
                recording_consented_at=CASE WHEN recording_consent_required THEN $2 ELSE recording_consented_at END
          WHERE interview_request_id=$1`,
        [interviewRequestId, now.toISOString()]
      );
      await insertEvent(tx, session.interview_session_id, principal.accountId, "WORKER_READY", now, null, {
        cameraReady: true,
        microphoneReady: true,
        connectionReady: true,
        identityConfirmed: true,
        recordingConsent: input.recordingConsent
      });
      return readView(tx, interviewRequestId);
    });
  }

  async claim(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "assessor") throw new InterviewRuntimeAccessError();
      if (!["ASSIGNED","WAITING_ROOM"].includes(request.status)) {
        throw new InterviewRuntimeConflictError("Interview cannot be claimed in its current state.");
      }
      const session = await ensureWaitingRoomSession(tx, request, now);
      if (session.claimed_at) return readView(tx, interviewRequestId);
      const result = await tx.query(
        `UPDATE interview_runtime_sessions
            SET claimed_at=$2,
                status=CASE WHEN worker_ready_at IS NULL THEN 'CLAIMED' ELSE 'READY' END,
                updated_at=$2
          WHERE interview_request_id=$1 AND claimed_at IS NULL`,
        [interviewRequestId, now.toISOString()]
      );
      if (result.affectedRows !== 1) throw new InterviewRuntimeConflictError();
      await insertEvent(tx, session.interview_session_id, principal.accountId, "CLAIMED", now);
      return readView(tx, interviewRequestId);
    });
  }

  async admit(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "assessor") throw new InterviewRuntimeAccessError();
      const session = await sessionForUpdate(tx, interviewRequestId);
      if (!session?.claimed_at || session.status !== "READY") {
        throw new InterviewRuntimeConflictError("The assigned Worker must be Ready before admission.");
      }
      const result = await tx.query(
        "UPDATE interview_runtime_sessions SET status='ADMITTED',admitted_at=$2,updated_at=$2 WHERE interview_request_id=$1 AND status='READY'",
        [interviewRequestId, now.toISOString()]
      );
      if (result.affectedRows !== 1) throw new InterviewRuntimeConflictError();
      await insertEvent(tx, session.interview_session_id, principal.accountId, "ADMITTED", now);
      return readView(tx, interviewRequestId);
    });
  }

  async start(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "assessor") throw new InterviewRuntimeAccessError();
      if (request.recording_consent_required && !request.recording_consented_at) {
        throw new InterviewRuntimeConflictError("Required interview recording consent has not been recorded.");
      }
      const session = await sessionForUpdate(tx, interviewRequestId);
      if (!session?.claimed_at || session.status !== "ADMITTED") {
        throw new InterviewRuntimeConflictError("Interview must be claimed, ready and admitted before Start.");
      }
      const result = await tx.query(
        "UPDATE interview_runtime_sessions SET status='ACTIVE',started_at=$2,updated_at=$2 WHERE interview_request_id=$1 AND status='ADMITTED'",
        [interviewRequestId, now.toISOString()]
      );
      if (result.affectedRows !== 1) throw new InterviewRuntimeConflictError();
      await insertEvent(tx, session.interview_session_id, principal.accountId, "STARTED", now);
      return readView(tx, interviewRequestId);
    });
  }

  async pause(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    pauseReason: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const normalized = reason(pauseReason, "Pause reason");
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "assessor") throw new InterviewRuntimeAccessError();
      const session = await sessionForUpdate(tx, interviewRequestId);
      if (!session || session.status !== "ACTIVE") {
        throw new InterviewRuntimeConflictError("Only an active interview can be paused.");
      }
      await tx.query(
        "UPDATE interview_runtime_sessions SET status='PAUSED',pause_reason=$2,paused_at=$3,updated_at=$3 WHERE interview_request_id=$1 AND status='ACTIVE'",
        [interviewRequestId, normalized, now.toISOString()]
      );
      await insertEvent(tx, session.interview_session_id, principal.accountId, "PAUSED", now, normalized);
      return readView(tx, interviewRequestId);
    });
  }

  async resume(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "assessor") throw new InterviewRuntimeAccessError();
      const session = await sessionForUpdate(tx, interviewRequestId);
      if (!session || !["PAUSED","TECHNICAL_HOLD"].includes(session.status)) {
        throw new InterviewRuntimeConflictError("Interview is not paused or on technical hold.");
      }
      await tx.query(
        "UPDATE interview_runtime_sessions SET status='ACTIVE',pause_reason=NULL,paused_at=NULL,updated_at=$2 WHERE interview_request_id=$1 AND status IN ('PAUSED','TECHNICAL_HOLD')",
        [interviewRequestId, now.toISOString()]
      );
      await tx.query(
        "UPDATE interview_requests SET technical_issue=NULL WHERE interview_request_id=$1",
        [interviewRequestId]
      );
      await insertEvent(tx, session.interview_session_id, principal.accountId, "RESUMED", now);
      return readView(tx, interviewRequestId);
    });
  }

  async technicalIssue(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    issueInput: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const issue = reason(issueInput, "Technical issue");
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      assertParticipant(principal, request);
      const session = await ensureWaitingRoomSession(tx, request, now);
      if (["ENDED","NO_SHOW"].includes(session.status)) {
        throw new InterviewRuntimeConflictError("Interview is already closed.");
      }
      await tx.query(
        "UPDATE interview_runtime_sessions SET status='TECHNICAL_HOLD',pause_reason=$2,paused_at=$3,updated_at=$3 WHERE interview_request_id=$1",
        [interviewRequestId, issue, now.toISOString()]
      );
      await tx.query(
        "UPDATE interview_requests SET technical_issue=$2 WHERE interview_request_id=$1",
        [interviewRequestId, issue]
      );
      await insertEvent(tx, session.interview_session_id, principal.accountId, "TECHNICAL_ISSUE", now, issue);
      return readView(tx, interviewRequestId);
    });
  }

  async noShow(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "assessor") throw new InterviewRuntimeAccessError();
      if (!request.scheduled_at) throw new InterviewRuntimeConflictError("Interview has no scheduled time.");
      const scheduled = new Date(request.scheduled_at).getTime();
      if (now.getTime() < scheduled + 15 * 60 * 1000) {
        throw new InterviewRuntimeConflictError("No-show review opens 15 minutes after the scheduled time.");
      }
      const session = await ensureWaitingRoomSession(tx, request, now);
      if (session.worker_ready_at || ["ACTIVE","ENDED"].includes(session.status)) {
        throw new InterviewRuntimeConflictError("A ready or active Worker cannot be marked no-show.");
      }
      await tx.query(
        "UPDATE interview_runtime_sessions SET status='NO_SHOW',ended_at=$2,updated_at=$2 WHERE interview_request_id=$1",
        [interviewRequestId, now.toISOString()]
      );
      await tx.query(
        "UPDATE interview_requests SET no_show_at=$2 WHERE interview_request_id=$1",
        [interviewRequestId, now.toISOString()]
      );
      await insertEvent(tx, session.interview_session_id, principal.accountId, "NO_SHOW", now);
      return readView(tx, interviewRequestId);
    });
  }

  async end(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewRuntimeView> {
    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const request = await requestForUpdate(tx, interviewRequestId);
      if (assertParticipant(principal, request) !== "assessor") throw new InterviewRuntimeAccessError();
      const session = await sessionForUpdate(tx, interviewRequestId);
      if (!session || !["ACTIVE","PAUSED","TECHNICAL_HOLD"].includes(session.status)) {
        throw new InterviewRuntimeConflictError("Only a started interview can be ended.");
      }

      const draft = await tx.query<{ scorecard: unknown }>(
        `SELECT scorecard
           FROM interview_console_drafts
          WHERE tenant_id=$1 AND interview_request_id=$2
          ORDER BY updated_at DESC
          LIMIT 1`,
        [request.tenant_id, interviewRequestId]
      );
      const scorecard = draft.rows[0]?.scorecard as Record<string, unknown> | undefined;
      const required = [
        "technicalKnowledge","practicalReasoning","safetyAwareness","communication",
        "consistencyWithWrittenAnswers","confidenceClarity","tradeJudgment"
      ];
      if (!scorecard || required.some((field) => !Number.isInteger(Number(scorecard[field])))) {
        throw new InterviewRuntimeConflictError(
          "Complete and save every required scorecard dimension before ending the interview."
        );
      }

      await tx.query(
        "UPDATE interview_runtime_sessions SET status='ENDED',ended_at=$2,updated_at=$2 WHERE interview_request_id=$1",
        [interviewRequestId, now.toISOString()]
      );
      await insertEvent(tx, session.interview_session_id, principal.accountId, "ENDED", now);
      return readView(tx, interviewRequestId);
    });
  }
}

let service: InterviewRuntimeService | null = null;
export function getInterviewRuntimeService(): InterviewRuntimeService {
  service ??= new InterviewRuntimeService();
  return service;
}
