// @ts-expect-error Runtime tests execute this TypeScript module directly.
import { createIdentifier } from "../auth/auth-domain.ts";
import type { AuthenticatedSession } from "../auth/auth-session-service";
import type { DatabaseClient } from "../database/database";

export type InterviewMediaRole = "worker" | "assessor";
export type InterviewMediaSignalKind = "offer" | "answer" | "ice" | "leave";

export type InterviewMediaAccess = Readonly<{
  tenantId: string;
  interviewRequestId: string;
  role: InterviewMediaRole;
  peerAccountId: string;
  scheduledAt: string;
  status: "ASSIGNED" | "WAITING_ROOM";
}>;

export type InterviewMediaSignal = Readonly<{
  signalId: string;
  kind: InterviewMediaSignalKind;
  payload: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

type InterviewAccessRow = {
  tenant_id: string;
  interview_request_id: string;
  worker_account_id: string;
  assessor_account_id: string | null;
  status: string;
  scheduled_at: string | Date | null;
};

type SignalRow = {
  signal_id: string;
  signal_kind: InterviewMediaSignalKind;
  payload: Record<string, unknown>;
  created_at: string | Date;
};

export class InterviewMediaAccessError extends Error {
  readonly status: 401 | 403 | 404 | 409;

  constructor(
    message: string,
    status: 401 | 403 | 404 | 409 = 403
  ) {
    super(message);
    this.name = "InterviewMediaAccessError";
    this.status = status;
  }
}

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function assertMediaRole(session: AuthenticatedSession): InterviewMediaRole {
  if (session.role !== "worker" && session.role !== "assessor") {
    throw new InterviewMediaAccessError("Interview media is limited to the assigned Worker and Assessor.", 403);
  }
  return session.role;
}

function normalizeConnectionId(value: unknown): string {
  if (typeof value !== "string") {
    throw new InterviewMediaAccessError("Interview media connection identifier is invalid.", 409);
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(normalized)) {
    throw new InterviewMediaAccessError("Interview media connection identifier is invalid.", 409);
  }
  return normalized;
}

function normalizePayload(
  kind: InterviewMediaSignalKind,
  payload: unknown
): Readonly<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InterviewMediaAccessError("Interview media signal payload is invalid.", 409);
  }
  const value = payload as Record<string, unknown>;
  const connectionId = normalizeConnectionId(value.connectionId);

  if (kind === "offer" || kind === "answer") {
    if (value.type !== kind || typeof value.sdp !== "string" || value.sdp.length < 1 || value.sdp.length > 24_000) {
      throw new InterviewMediaAccessError("Interview session description is invalid.", 409);
    }
    return Object.freeze({ connectionId, type: kind, sdp: value.sdp });
  }

  if (kind === "ice") {
    if (typeof value.candidate !== "string" || value.candidate.length > 8_000) {
      throw new InterviewMediaAccessError("Interview ICE candidate is invalid.", 409);
    }
    const sdpMid =
      value.sdpMid === null || typeof value.sdpMid === "string"
        ? value.sdpMid
        : null;
    const sdpMLineIndex =
      value.sdpMLineIndex === null || Number.isInteger(value.sdpMLineIndex)
        ? value.sdpMLineIndex
        : null;
    return Object.freeze({
      connectionId,
      candidate: value.candidate,
      sdpMid,
      sdpMLineIndex
    });
  }

  return Object.freeze({ connectionId, reason: "participant_left" });
}

export async function authorizeInterviewMedia(
  database: DatabaseClient,
  session: AuthenticatedSession,
  interviewRequestId: string
): Promise<InterviewMediaAccess> {
  const role = assertMediaRole(session);
  const requestId = interviewRequestId.trim();
  if (!requestId || requestId.length > 200) {
    throw new InterviewMediaAccessError("Interview request is invalid.", 404);
  }

  const result = await database.query<InterviewAccessRow>(
    `SELECT tenant_id,interview_request_id,worker_account_id,assessor_account_id,status,scheduled_at
       FROM interview_requests
      WHERE interview_request_id=$1
      LIMIT 1`,
    [requestId]
  );
  const row = result.rows[0];
  if (!row) throw new InterviewMediaAccessError("Interview request was not found.", 404);

  if (role === "worker" && row.worker_account_id !== session.accountId) {
    throw new InterviewMediaAccessError("Interview Worker ownership mismatch.", 403);
  }
  if (role === "assessor" && row.assessor_account_id !== session.accountId) {
    throw new InterviewMediaAccessError("Interview Assessor assignment mismatch.", 403);
  }
  if (!row.assessor_account_id) {
    throw new InterviewMediaAccessError("Interview has not been assigned to an Assessor.", 409);
  }
  if (row.status !== "ASSIGNED" && row.status !== "WAITING_ROOM") {
    throw new InterviewMediaAccessError("Interview is not open for live media.", 409);
  }
  if (!row.scheduled_at) {
    throw new InterviewMediaAccessError("Interview must be scheduled before live media can start.", 409);
  }

  return Object.freeze({
    tenantId: row.tenant_id,
    interviewRequestId: row.interview_request_id,
    role,
    peerAccountId:
      role === "worker" ? row.assessor_account_id : row.worker_account_id,
    scheduledAt: timestamp(row.scheduled_at),
    status: row.status
  });
}

export async function publishInterviewMediaSignal(
  database: DatabaseClient,
  session: AuthenticatedSession,
  interviewRequestId: string,
  input: Readonly<{ kind: InterviewMediaSignalKind; payload: unknown }>
): Promise<InterviewMediaSignal> {
  const access = await authorizeInterviewMedia(database, session, interviewRequestId);
  if (!["offer", "answer", "ice", "leave"].includes(input.kind)) {
    throw new InterviewMediaAccessError("Interview media signal type is invalid.", 409);
  }
  const payload = normalizePayload(input.kind, input.payload);
  const signalId = createIdentifier("interview_media_signal");
  const result = await database.query<SignalRow>(
    `INSERT INTO interview_media_signals(
       signal_id,tenant_id,interview_request_id,actor_account_id,actor_role,
       signal_kind,payload,created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
     RETURNING signal_id,signal_kind,payload,created_at`,
    [
      signalId,
      access.tenantId,
      access.interviewRequestId,
      session.accountId,
      access.role,
      input.kind,
      JSON.stringify(payload)
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Interview media signal was not persisted.");
  return Object.freeze({
    signalId: row.signal_id,
    kind: row.signal_kind,
    payload: Object.freeze({ ...row.payload }),
    createdAt: timestamp(row.created_at)
  });
}

export async function listInterviewMediaSignals(
  database: DatabaseClient,
  session: AuthenticatedSession,
  interviewRequestId: string
): Promise<readonly InterviewMediaSignal[]> {
  const access = await authorizeInterviewMedia(database, session, interviewRequestId);
  const result = await database.query<SignalRow>(
    `SELECT signal_id,signal_kind,payload,created_at
       FROM interview_media_signals
      WHERE tenant_id=$1
        AND interview_request_id=$2
        AND actor_account_id=$3
      ORDER BY created_at ASC,signal_id ASC
      LIMIT 100`,
    [access.tenantId, access.interviewRequestId, access.peerAccountId]
  );
  return Object.freeze(
    result.rows.map((row) =>
      Object.freeze({
        signalId: row.signal_id,
        kind: row.signal_kind,
        payload: Object.freeze({ ...row.payload }),
        createdAt: timestamp(row.created_at)
      })
    )
  );
}

export function getBuiltInInterviewIceServers(): readonly RTCIceServer[] {
  const configured = (process.env.HSE_WEBRTC_STUN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const urls = configured.length > 0
    ? configured
    : ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];
  return Object.freeze([{ urls: [...urls] }]);
}