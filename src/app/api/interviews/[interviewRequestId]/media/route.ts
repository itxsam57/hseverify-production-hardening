import { NextResponse } from "next/server";

import { readAuthenticatedSession } from "@/lib/auth/auth-session-service";
import { getDatabaseClient } from "@/lib/database/database";
import {
  InterviewMediaAccessError,
  authorizeInterviewMedia,
  getBuiltInInterviewIceServers,
  listInterviewMediaSignals,
  publishInterviewMediaSignal,
  type InterviewMediaSignalKind
} from "@/lib/interview/interview-media-service";

const MAX_BODY_BYTES = 40_000;

function noStore<T>(body: T, init?: ResponseInit): NextResponse<T> {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof InterviewMediaAccessError) {
    return noStore(
      { error: error.message },
      { status: error.status }
    );
  }
  console.error("Interview media request failed", error);
  return noStore(
    { error: "Interview media is temporarily unavailable." },
    { status: 503 }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ interviewRequestId: string }> }
): Promise<NextResponse> {
  try {
    const session = await readAuthenticatedSession();
    if (!session) return noStore({ error: "Authentication required." }, { status: 401 });
    const { interviewRequestId } = await params;
    const database = await getDatabaseClient();
    const access = await authorizeInterviewMedia(database, session, interviewRequestId, { allowCompleted: true });
    const signals = await listInterviewMediaSignals(database, session, interviewRequestId, { allowCompleted: true });
    return noStore({
      role: access.role,
      status: access.status,
      scheduledAt: access.scheduledAt,
      iceServers: getBuiltInInterviewIceServers(),
      signals
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ interviewRequestId: string }> }
): Promise<NextResponse> {
  try {
    const session = await readAuthenticatedSession();
    if (!session) return noStore({ error: "Authentication required." }, { status: 401 });

    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null) {
      const length = Number(declaredLength);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
        return noStore({ error: "Interview media signal is too large." }, { status: 413 });
      }
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return noStore({ error: "Interview media signal is too large." }, { status: 413 });
    }

    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return noStore({ error: "Interview media signal is invalid." }, { status: 400 });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return noStore({ error: "Interview media signal is invalid." }, { status: 400 });
    }

    const value = input as { kind?: unknown; payload?: unknown };
    const kind = value.kind;
    if (
      kind !== "offer" &&
      kind !== "answer" &&
      kind !== "ice" &&
      kind !== "leave"
    ) {
      return noStore({ error: "Interview media signal type is invalid." }, { status: 400 });
    }

    const { interviewRequestId } = await params;
    const signal = await publishInterviewMediaSignal(
      await getDatabaseClient(),
      session,
      interviewRequestId,
      { kind: kind as InterviewMediaSignalKind, payload: value.payload }
    );
    return noStore({ signal }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
