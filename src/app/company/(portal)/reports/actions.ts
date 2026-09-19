"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { deriveTrustedTenantScope } from "@/lib/authorization/tenant-scoped-resource-domain";
import { ReportDeliveryRepository } from "@/lib/reports/report-delivery-repository";
import { ReportDeliveryService } from "@/lib/reports/report-delivery-service";

function value(formData: FormData, name: string): string {
  const item = formData.get(name);
  return typeof item === "string" ? item : "";
}

export async function queueReport(formData: FormData): Promise<void> {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  const scope = deriveTrustedTenantScope(principal);
  await new ReportDeliveryService(new ReportDeliveryRepository()).queue({
    reportId: value(formData, "reportId"),
    tenantId: scope.tenantId,
    requestedBy: principal.accountId,
    format: value(formData, "format") as "pdf" | "csv" | "print",
    requestedAt: new Date().toISOString(),
    scheduleAt: value(formData, "scheduleAt") || undefined
  });
  revalidatePath("/company/reports");
}

export async function listCompanyReports() {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  const scope = deriveTrustedTenantScope(principal);
  return new ReportDeliveryRepository().listForTenant(scope.tenantId);
}
