"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createIdentifier } from "@/lib/auth/auth-domain";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { ReportConflictError, ReportInputError, REPORT_FORMATS, type ReportFormat } from "@/lib/reports/report-delivery-domain";
import { ReportDefinitionService } from "@/lib/reports/report-definition-service";
import { isWorkerReportType, normalizeReportFilters } from "@/lib/reports/report-types";
import { getWorkerReportService } from "@/lib/reports/worker-report-service";

function value(form: FormData, name: string): string {
  const entry = form.get(name);
  return typeof entry === "string" ? entry : "";
}
function utc(raw: string): string | undefined {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) {
    throw new ReportInputError("Enter a valid UTC date and time.");
  }
  const instant = new Date(raw + "Z");
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, raw.length) !== raw) {
    throw new ReportInputError("Enter a valid UTC date and time.");
  }
  return instant.toISOString();
}
function configuration(form: FormData) {
  const reportType = value(form, "reportType"), format = value(form, "format");
  if (!isWorkerReportType(reportType) || !REPORT_FORMATS.includes(format as ReportFormat)) {
    throw new ReportInputError("Choose a valid report type and format.");
  }
  let filters;
  try {
    filters = normalizeReportFilters({ from: utc(value(form, "fromAt")) ?? null, to: utc(value(form, "toAt")) ?? null });
  } catch {
    throw new ReportInputError("Enter a valid UTC date range with the start before the end.");
  }
  return { reportType, format: format as ReportFormat, filters, queueEmail: form.get("queueEmail") === "on" };
}
function requiredVersion(form: FormData, name: string): number {
  const raw = value(form, name);
  if (!/^[1-9]\d{0,3}$/.test(raw) || Number(raw) > 1000) throw new ReportInputError("The saved report version is required.");
  return Number(raw);
}
function notice(error: unknown): string {
  return error instanceof ReportInputError || error instanceof ReportConflictError
    ? error.message : "The report request could not be completed. Reload and try again.";
}
function finish(errorMessage: string | null, result: string): never {
  revalidatePath("/worker/reports");
  redirect("/worker/reports?" + (errorMessage ? "error=" + encodeURIComponent(errorMessage) : "notice=" + result));
}
export async function queueWorkerReport(form: FormData): Promise<void> {
  const principal = await requirePortalAuthorization("worker");
  let errorMessage: string | null = null;
  try {
    await getWorkerReportService().queue(principal, {
      ...configuration(form), reportId: createIdentifier("report_worker"),
      requestedAt: new Date().toISOString(), scheduleAt: utc(value(form, "scheduleAt"))
    });
  } catch (error) { errorMessage = notice(error); }
  finish(errorMessage, "queued");
}
export async function queueSavedWorkerReport(form: FormData): Promise<void> {
  const principal = await requirePortalAuthorization("worker");
  let errorMessage: string | null = null;
  try {
    const definition = await new ReportDefinitionService(await getDatabaseClient()).resolveWorker(
      principal, value(form, "definitionId"), requiredVersion(form, "definitionVersion")
    );
    if (!isWorkerReportType(definition.reportType)) throw new ReportInputError();
    await getWorkerReportService().queue(principal, {
      reportId: createIdentifier("report_worker"), requestedAt: new Date().toISOString(),
      reportType: definition.reportType, format: definition.format, filters: definition.filters,
      queueEmail: definition.queueEmail, definitionId: definition.definitionId, definitionVersion: definition.version,
      scheduleAt: utc(value(form, "scheduleAt"))
    });
  } catch (error) { errorMessage = notice(error); }
  finish(errorMessage, "queued");
}
export async function saveWorkerReportDefinition(form: FormData): Promise<void> {
  const principal = await requirePortalAuthorization("worker");
  let errorMessage: string | null = null;
  try {
    const definitionId = value(form, "editDefinitionId");
    await new ReportDefinitionService(await getDatabaseClient()).saveWorker(principal, {
      ...configuration(form), name: value(form, "definitionName"), definitionId: definitionId || undefined,
      expectedVersion: definitionId ? requiredVersion(form, "expectedVersion") : undefined
    });
  } catch (error) { errorMessage = notice(error); }
  finish(errorMessage, "saved");
}
export async function retryWorkerReport(form: FormData): Promise<void> {
  const principal = await requirePortalAuthorization("worker");
  let errorMessage: string | null = null;
  try { await getWorkerReportService().retry(principal, value(form, "reportId")); }
  catch (error) { errorMessage = notice(error); }
  finish(errorMessage, "retried");
}
