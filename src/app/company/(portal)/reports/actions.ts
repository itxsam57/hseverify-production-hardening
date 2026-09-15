"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { ReportDeliveryRepository } from "@/lib/reports/report-delivery-repository";
import { ReportDeliveryService } from "@/lib/reports/report-delivery-service";

function value(formData: FormData, name: string): string {
  const item = formData.get(name);
  return typeof item === "string" ? item : "";
}

export async function queueReport(formData: FormData): Promise<void> {
  const principal = await requireCurrentTenantPermission("company.audit.read");
  const identity = principal as unknown as { tenantId: string; userId: string };
  await new ReportDeliveryService(new ReportDeliveryRepository()).queue({
    reportId: value(formData, "reportId"),
    tenantId: identity.tenantId,
    requestedBy: identity.userId,
    format: value(formData, "format") as "pdf" | "csv" | "print",
    requestedAt: new Date().toISOString()
  });
  revalidatePath("/company/reports");
}
