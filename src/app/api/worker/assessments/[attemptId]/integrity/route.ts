import { NextResponse } from "next/server";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getAssessmentAttemptService } from "@/lib/assessment-attempt/assessment-attempt-service";
import { readAssessmentAccessContext } from "@/lib/assessment-attempt/assessment-device-cookie";
import {
  AssessmentIntegrityAccessError,
  AssessmentIntegrityInputError,
  getAssessmentIntegrityService
} from "@/lib/integrity/assessment-integrity-service";
import { IntegrityEventInputError, type IntegrityEventType } from "@/lib/integrity/integrity-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function principal() {
  return requirePlatformPermission({
    expectedRole: "worker",
    permission: "worker.assessments.read"
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ attemptId: string }> }
): Promise<Response> {
  try {
    const [{ attemptId }, actor, access] = await Promise.all([
      context.params,
      principal(),
      readAssessmentAccessContext()
    ]);
    const policy = await getAssessmentIntegrityService().policy(actor, attemptId, access);
    return NextResponse.json({ policy }, {
      status: 200,
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof AssessmentIntegrityAccessError) {
      // Closed attempts still need to show the server-owned submitted receipt.
      // Verify the same Worker/session/device binding before waiving monitoring.
      try {
        const [{ attemptId }, actor, access] = await Promise.all([
          context.params,
          principal(),
          readAssessmentAccessContext()
        ]);
        const view = await (await getAssessmentAttemptService()).getOwnedView(actor, attemptId, new Date(), access);
        if (view.submitted) {
          return NextResponse.json({ policy: {
            requireCamera: false,
            requireMicrophone: false,
            requireScreenShare: false,
            recordCamera: false,
            recordMicrophone: false,
            recordScreen: false,
            recordingRetentionDays: 30,
            integrityFailureMode: "BLOCK",
            requireFullscreen: false
          } }, { status: 200, headers: { "cache-control": "private, no-store" } });
        }
      } catch {
        // A non-owner, unbound device or an active attempt cannot bypass monitoring.
      }
      return NextResponse.json({ error: "Assessment integrity access denied." }, { status: 403 });
    }
    return NextResponse.json({ error: "Assessment integrity policy is unavailable." }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
): Promise<Response> {
  try {
    const [{ attemptId }, actor, access, body] = await Promise.all([
      context.params,
      principal(),
      readAssessmentAccessContext(),
      request.json() as Promise<{
        type?: string;
        occurredAt?: string;
        details?: unknown;
        providerState?: "BUILT_IN" | "EXTERNAL_READY" | "DEGRADED" | "UNAVAILABLE";
      }>
    ]);
    const event = await getAssessmentIntegrityService().record(
      actor,
      attemptId,
      access,
      {
        type: String(body.type ?? "") as IntegrityEventType,
        occurredAt: body.occurredAt,
        details: body.details,
        providerState: body.providerState
      }
    );
    return NextResponse.json({
      event: {
        eventId: event.eventId,
        type: event.type,
        classification: event.classification,
        state: event.state,
        occurredAt: event.occurredAt
      }
    }, {
      status: 201,
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof AssessmentIntegrityAccessError) {
      return NextResponse.json({ error: "Assessment integrity access denied." }, { status: 403 });
    }
    if (
      error instanceof AssessmentIntegrityInputError ||
      error instanceof IntegrityEventInputError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Integrity signal could not be recorded." }, { status: 400 });
  }
}
