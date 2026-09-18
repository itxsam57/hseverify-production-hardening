import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { IntegrityCaptureService } from "@/lib/integrity/integrity-capture-service";
import { IntegrityCaptureIntegration } from "@/lib/integrity/integrity-capture-integration";
import { requireWorkerSession } from "@/lib/auth/worker-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function integrationForAttempt(attemptId: string) {
  return new IntegrityCaptureIntegration(new IntegrityCaptureService(undefined, attemptId));
}

async function localIntegrityAttemptId() {
  const store = await cookies();
  const existing = store.get("hse_integrity_attempt")?.value;
  if (existing) return existing;

  const generated = `local-integrity-${crypto.randomUUID()}`;
  store.set("hse_integrity_attempt", generated, {
    httpOnly: true,
    sameSite: "lax"
  });
  return generated;
}

async function integritySession() {
  try {
    return await requireWorkerSession();
  } catch (error) {
    // Local deterministic fixture for disposable runtime/browser verification.
    // Production requests still require the authenticated worker boundary.
    if (process.env.NODE_ENV !== "production") {
      return {
        workerId: await localIntegrityAttemptId()
      };
    }
    throw error;
  }
}

export async function GET(): Promise<Response> {
  const session = await integritySession();
  return NextResponse.json({
    integrity: await integrationForAttempt(session.workerId).currentAssessmentIntegrityState()
  });
}

export async function POST(request: Request): Promise<Response> {
  let session: { workerId: string };
  try {
    session = await integritySession();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Authentication required." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const integration = integrationForAttempt(session.workerId);
    const event = await integration.recordAssessmentIntegritySignal({
      type: body.type,
      occurredAt: body.occurredAt ?? new Date().toISOString(),
      details: body.details
    });
    const integrity = await integration.currentAssessmentIntegrityState();

    return NextResponse.json({ event, integrity }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid integrity event." },
      { status: 400 }
    );
  }
}
