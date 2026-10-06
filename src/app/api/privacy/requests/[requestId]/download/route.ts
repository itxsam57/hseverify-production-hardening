import { NextResponse } from "next/server";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { PrivacyOperationsService } from "@/lib/privacy/privacy-operations-service";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff"
};

export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const principal = await requirePortalAuthorization("worker");
  const { requestId } = await context.params;
  try {
    const data = await new PrivacyOperationsService().downloadWorkerData(requestId,principal.accountId);
    return NextResponse.json(data, { headers: {
      ...headers, "Content-Disposition": 'attachment; filename="hse-verify-personal-data.json"'
    } });
  } catch {
    return NextResponse.json({ error: "worker_data_unavailable" }, { status: 404, headers });
  }
}
