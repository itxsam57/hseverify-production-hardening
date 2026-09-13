import { NextResponse } from "next/server";
import { IntegrityCaptureService } from "@/lib/integrity/integrity-capture-service";
import { IntegrityCaptureIntegration } from "@/lib/integrity/integrity-capture-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const globalForIntegrity = globalThis as typeof globalThis & {
  __hseIntegrityCaptureService?: IntegrityCaptureService;
};

const captureService = globalForIntegrity.__hseIntegrityCaptureService ?? new IntegrityCaptureService();
globalForIntegrity.__hseIntegrityCaptureService = captureService;
const integration = new IntegrityCaptureIntegration(captureService);

export async function GET(): Promise<Response> {
  return NextResponse.json({
    integrity: integration.currentAssessmentIntegrityState()
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const event = integration.recordAssessmentIntegritySignal({
      type: body.type,
      occurredAt: body.occurredAt ?? new Date().toISOString(),
      details: body.details
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid integrity event." },
      { status: 400 }
    );
  }
}
