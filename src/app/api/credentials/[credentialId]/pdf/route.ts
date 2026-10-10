import { resolvePublicCredentialRequest } from "@/lib/public-verification/public-verification-runtime";
import { renderReportPdf } from "@/lib/reports/report-renderer";

export async function GET(_request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const { credentialId } = await context.params;
  const result = await resolvePublicCredentialRequest(credentialId);
  if (result.kind !== "projection") return new Response(result.status, {
    status: result.status === "temporarily_unavailable" ? 503 : 404,
    headers: { "Cache-Control": "no-store" }
  });
  const credential = result.projection;

  try {
    const bytes = await renderReportPdf({
      kind: "credential",
      reportId: credential.publicIdentifier,
      title: "HSE Verify Credential",
      requestedAt: credential.issuedAt ?? credential.verifiedAt,
      headers: ["Qualification", "Status", "Issue", "Expiry", "Verification", "Restrictions"],
      rows: [{
        Qualification: credential.competencyTitle ?? "Not specified",
        Status: credential.status,
        Issue: credential.issuedAt ?? "Not specified",
        Expiry: credential.expiresAt ?? "Not specified",
        Verification: `/verify/result/${credential.publicIdentifier}`,
        Restrictions: credential.restrictions.length ? credential.restrictions.join("\n") : "None"
      }]
    });
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" }
    });
  } catch {
    return new Response("temporarily_unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
