import { NextResponse } from "next/server";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { ReportDeliveryRepository } from "@/lib/reports/report-delivery-repository";
import { createPrintDeliveryPayload, createReportCsv, createReportPdf } from "@/lib/reports/report-delivery-domain";

export async function GET(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  const identity = principal as unknown as { tenantId: string };
  const { reportId } = await params;
  const delivery = await new ReportDeliveryRepository().find(reportId, identity.tenantId);

  if (!delivery) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  if (delivery.format === "pdf") {
    return new NextResponse(createReportPdf(reportId, "Company report"), {
      headers: { "content-type": "application/pdf" }
    });
  }

  if (delivery.format === "print") {
    return NextResponse.json(createPrintDeliveryPayload(reportId));
  }

  return new NextResponse(createReportCsv([{ reportId, status: delivery.status }]), {
    headers: { "content-type": "text/csv" }
  });
}
