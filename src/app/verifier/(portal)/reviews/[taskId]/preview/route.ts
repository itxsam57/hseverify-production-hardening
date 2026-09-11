import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getEvidenceReviewService } from "@/lib/review/evidence-review-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const principal = await requirePlatformPermission({
    expectedRole: "verifier",
    permission: "verification.assigned.read"
  });
  const content = await (await getEvidenceReviewService()).preview(principal, taskId);
  const responseBytes = Uint8Array.from(content.bytes);
  return new Response(responseBytes, { status: 200, headers: content.headers });
}
