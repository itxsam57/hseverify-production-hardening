import { NextResponse } from "next/server";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { readAssessmentAccessContext } from "@/lib/assessment-attempt/assessment-device-cookie";
import {
  RecordingAssetAccessError,
  RecordingAssetInputError,
  getRecordingAssetService
} from "@/lib/recording/recording-asset-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
): Promise<Response> {
  try {
    const [{ attemptId }, actor, access, buffer] = await Promise.all([
      context.params,
      requirePlatformPermission({
        expectedRole: "worker",
        permission: "worker.assessments.read"
      }),
      readAssessmentAccessContext(),
      request.arrayBuffer()
    ]);
    const source = request.headers.get("x-recording-source") ?? "";
    const ingestKey = request.headers.get("x-recording-segment-key") ?? "";
    const startedAt = request.headers.get("x-recording-started-at") ?? "";
    const endedAt = request.headers.get("x-recording-ended-at") ?? "";
    const mimeType = request.headers.get("content-type") ?? "";

    const asset = await getRecordingAssetService().storeAssessmentSegment(
      actor,
      attemptId,
      access,
      {
        ingestKey,
        source,
        mimeType,
        bytes: new Uint8Array(buffer),
        startedAt,
        endedAt
      }
    );
    return NextResponse.json({ asset }, {
      status: asset.status === "AVAILABLE" ? 201 : 202,
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof RecordingAssetAccessError) {
      return NextResponse.json({ error: "Recording access denied." }, { status: 403 });
    }
    if (error instanceof RecordingAssetInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Recording could not be stored. Monitoring is degraded and requires review." },
      { status: 503 }
    );
  }
}
