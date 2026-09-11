"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import {
  CompanyOrganizationConflictError,
  CompanyOrganizationInputError,
  CompanyOrganizationNotFoundError,
  type CompanyUnitKind
} from "@/lib/company/company-organization-domain";
import { getCompanyOrganizationRepository } from "@/lib/company/company-organization-repository";

export type CompanyOrganizationActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string | null;
}>;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
function kind(formData: FormData): CompanyUnitKind | null {
  const value = text(formData, "kind");
  return value === "site" || value === "department" ? value : null;
}
function revision(formData: FormData): number | null {
  const value = text(formData, "revision");
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}
function state(status: CompanyOrganizationActionState["status"], message: string): CompanyOrganizationActionState {
  return Object.freeze({ status, message });
}
function failure(error: unknown): CompanyOrganizationActionState {
  if (error instanceof CompanyOrganizationConflictError) return state("conflict", error.message);
  if (error instanceof CompanyOrganizationInputError) return state("error", error.message);
  if (error instanceof CompanyOrganizationNotFoundError) return state("error", "That Company unit is no longer available.");
  return state("error", "The Company organization change could not be completed safely.");
}
function refresh(): void {
  revalidatePath("/company/organization");
  revalidatePath("/company/dashboard");
}
function draft(formData: FormData) {
  return {
    name: text(formData, "name"),
    formattedAddress: text(formData, "formattedAddress"),
    phone: text(formData, "phone"),
    website: text(formData, "website"),
    email: text(formData, "email"),
    registrationNumber: text(formData, "registrationNumber")
  };
}

export async function createCompanyUnitAction(_previous: CompanyOrganizationActionState, formData: FormData): Promise<CompanyOrganizationActionState> {
  const unitKind = kind(formData);
  if (!unitKind) return state("error", "Choose a valid Company unit type.");
  try {
    const principal = await requireCurrentTenantPermission("company.settings.manage");
    await getCompanyOrganizationRepository().create(principal, unitKind, draft(formData));
    refresh();
    return state("success", `${unitKind === "site" ? "Site" : "Department"} created.`);
  } catch (error) { return failure(error); }
}

export async function updateCompanyUnitAction(_previous: CompanyOrganizationActionState, formData: FormData): Promise<CompanyOrganizationActionState> {
  const unitKind = kind(formData); const expectedRevision = revision(formData); const unitId = text(formData, "unitId");
  if (!unitKind || !unitId || expectedRevision === null) return state("conflict", "This Company unit form is stale. Reload and try again.");
  try {
    const principal = await requireCurrentTenantPermission("company.settings.manage");
    await getCompanyOrganizationRepository().update(principal, unitKind, unitId, expectedRevision, draft(formData));
    refresh();
    return state("success", "Company unit details saved.");
  } catch (error) { return failure(error); }
}

async function transition(formData: FormData, target: "archive" | "restore"): Promise<CompanyOrganizationActionState> {
  const unitKind = kind(formData); const expectedRevision = revision(formData); const unitId = text(formData, "unitId");
  if (!unitKind || !unitId || expectedRevision === null) return state("conflict", "This Company unit status is stale. Reload and try again.");
  try {
    const principal = await requireCurrentTenantPermission("company.settings.manage");
    const repository = getCompanyOrganizationRepository();
    if (target === "archive") await repository.archive(principal, unitKind, unitId, expectedRevision);
    else await repository.restore(principal, unitKind, unitId, expectedRevision);
    refresh();
    return state("success", target === "archive" ? "Company unit archived. Active Team assignments to it were ended; history was retained." : "Company unit restored. Historical assignments were not recreated.");
  } catch (error) { return failure(error); }
}
export async function archiveCompanyUnitAction(_previous: CompanyOrganizationActionState, formData: FormData): Promise<CompanyOrganizationActionState> { return transition(formData, "archive"); }
export async function restoreCompanyUnitAction(_previous: CompanyOrganizationActionState, formData: FormData): Promise<CompanyOrganizationActionState> { return transition(formData, "restore"); }
