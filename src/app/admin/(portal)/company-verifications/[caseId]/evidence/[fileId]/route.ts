import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getCompanyVerificationReviewService } from "@/lib/company/company-verification-review-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string; fileId: string }> }
): Promise<Response> {
  const { caseId, fileId } = await params;
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.tenants.manage"
  });
  const content = await (await getCompanyVerificationReviewService()).previewEvidence(
    principal,
    caseId,
    fileId
  );
  const responseBytes = Uint8Array.from(content.bytes);
  return new Response(responseBytes, {
    status: 200,
    headers: content.headers
  });
}
