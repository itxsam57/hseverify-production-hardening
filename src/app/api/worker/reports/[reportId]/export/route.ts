import { NextResponse } from "next/server";
import { readServerAuthorizationContext } from "@/lib/authorization/authorization-service";
import { ReportAccessError, ReportArtifactUnavailableError, ReportInputError, ReportNotFoundError } from "@/lib/reports/report-delivery-domain";
import { getWorkerReportService } from "@/lib/reports/worker-report-service";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0", "pragma": "no-cache",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY"
};
export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const resolution = await readServerAuthorizationContext();
  if (!resolution.allowed) {
    return NextResponse.json({ error: "Report authentication required." }, { status: 401, headers: PRIVATE_HEADERS });
  }
  if (resolution.principal.activeRole !== "worker" || resolution.principal.tenantMembership !== null) {
    return NextResponse.json({ error: "Report access denied." }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const { reportId } = await params;
  try {
    const { delivery, bytes } = await getWorkerReportService().download(resolution.principal, reportId);
    const extension = delivery.format === "print" ? "html" : delivery.format;
    return new NextResponse(Buffer.from(bytes), { headers: {
      ...PRIVATE_HEADERS, "content-type": delivery.artifactMimeType!, "content-length": String(bytes.byteLength),
      "content-disposition": (delivery.format === "print" ? "inline" : "attachment") + '; filename="' + delivery.reportId + "." + extension + '"',
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; sandbox"
    } });
  } catch (error) {
    const status = error instanceof ReportInputError || error instanceof ReportNotFoundError ? 404 :
      error instanceof ReportAccessError ? 403 : error instanceof ReportArtifactUnavailableError ? 409 : 503;
    const message = status === 404 ? "Report not found." : status === 403 ? "Report access denied." :
      status === 409 ? "The generated report is not available." : "Report download is temporarily unavailable.";
    return NextResponse.json({ error: message }, { status, headers: PRIVATE_HEADERS });
  }
}
