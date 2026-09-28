import { NextResponse } from "next/server";

import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";
import {
  RecordingAssetAccessError,
  RecordingAssetInputError,
  getRecordingAssetService
} from "@/lib/recording/recording-asset-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ interviewRequestId: string }> }
): Promise<Response> {
  try {
    const resolution = await readServerAuthorizationContext();
    if (
      !resolution.allowed ||
      !["worker", "assessor"].includes(resolution.principal.activeRole)
    ) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const [{ interviewRequestId }, buffer] = await Promise.all([
      params,
      request.arrayBuffer()
    ]);
    const asset = await getRecordingAssetService().storeInterviewSegment(
      resolution.principal,
      interviewRequestId,
      {
        ingestKey: request.headers.get("x-recording-segment-key") ?? "",
        source: request.headers.get("x-recording-source") ?? "",
        mimeType: request.headers.get("content-type") ?? "",
        bytes: new Uint8Array(buffer),
        startedAt: request.headers.get("x-recording-started-at") ?? "",
        endedAt: request.headers.get("x-recording-ended-at") ?? ""
      }
    );

    return NextResponse.json(
      { asset },
      {
        status: asset.status === "AVAILABLE" ? 201 : 202,
        headers: { "cache-control": "private, no-store" }
      }
    );
  } catch (error) {
    if (error instanceof RecordingAssetAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof RecordingAssetInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Interview recording upload failed", error);
    return NextResponse.json(
      { error: "Interview recording could not be stored." },
      { status: 503 }
    );
  }
}
