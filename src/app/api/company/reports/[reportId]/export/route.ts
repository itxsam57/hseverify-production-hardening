import { NextResponse } from "next/server";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { TenantScopeContractError, TenantScopeDeniedError } from "@/lib/authorization/tenant-scoped-resource-domain";
import {
  ReportAccessError, ReportArtifactUnavailableError, ReportInputError, ReportNotFoundError
} from "@/lib/reports/report-delivery-domain";
import { ReportDeliveryService } from "@/lib/reports/report-delivery-service";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0", "pragma": "no-cache",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "x-frame-options": "DENY"
};
export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const principal = await requireCurrentTenantPermission("company.reports.export");
  const { reportId } = await params;
  try {
    const { delivery, bytes } = await new ReportDeliveryService().download(principal, reportId);
    const extension = delivery.format === "print" ? "html" : delivery.format;
    const disposition = delivery.format === "print" ? "inline" : "attachment";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        ...PRIVATE_HEADERS, "content-type": delivery.artifactMimeType!,
        "content-length": String(bytes.byteLength),
        "content-disposition": disposition + '; filename="' + delivery.reportId + "." + extension + '"',
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; sandbox"
      }
    });
  } catch (error) {
    const status = error instanceof ReportNotFoundError || error instanceof ReportInputError ? 404 :
      error instanceof ReportAccessError || error instanceof TenantScopeDeniedError || error instanceof TenantScopeContractError ? 403 :
        error instanceof ReportArtifactUnavailableError ? 409 : 503;
    const message = status === 404 ? "Report not found." : status === 403 ? "Report access denied." :
      status === 409 ? "The generated report is not available." : "Report download is temporarily unavailable.";
    return NextResponse.json({ error: message }, { status, headers: PRIVATE_HEADERS });
  }
}
