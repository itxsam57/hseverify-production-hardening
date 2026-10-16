import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { EvidenceReviewAccessError } from "@/lib/review/evidence-review-domain";
import { SecureFileAccessDeniedError } from "@/lib/secure-files/secure-file-access-domain";
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
  try {
    const content = await (await getEvidenceReviewService()).preview(principal, taskId);
    return new Response(Uint8Array.from(content.bytes), { status: 200, headers: content.headers });
  } catch (error) {
    if (error instanceof EvidenceReviewAccessError || error instanceof SecureFileAccessDeniedError)
      return new Response("Evidence is unavailable.", { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    throw error;
  }
}
