import { createIdentifier, normalizeEmail } from "../auth/auth-domain";

export const COMPANY_UNIT_STATUSES = ["active", "archived"] as const;
export type CompanyUnitStatus = (typeof COMPANY_UNIT_STATUSES)[number];
export type CompanyUnitKind = "site" | "department";

export type CompanyUnitRecord = Readonly<{
  kind: CompanyUnitKind;
  unitId: string;
  tenantId: string;
  name: string;
  formattedAddress: string;
  phone: string;
  website: string;
  email: string;
  registrationNumber: string | null;
  status: CompanyUnitStatus;
  revision: number;
  createdByMembershipId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}>;

export type CompanyUnitDraftInput = Readonly<{
  name: string;
  formattedAddress: string;
  phone: string;
  website: string;
  email: string;
  registrationNumber?: string | null;
}>;

export type NormalizedCompanyUnitDraft = Readonly<{
  name: string;
  formattedAddress: string;
  phone: string;
  website: string;
  email: string;
  registrationNumber: string | null;
}>;

export class CompanyOrganizationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyOrganizationInputError";
  }
}

export class CompanyOrganizationNotFoundError extends Error {
  constructor() {
    super("The Company organization record could not be found.");
    this.name = "CompanyOrganizationNotFoundError";
  }
}

export class CompanyOrganizationConflictError extends Error {
  constructor(message = "The Company organization record changed. Reload and try again.") {
    super(message);
    this.name = "CompanyOrganizationConflictError";
  }
}

function normalizeText(value: string, label: string, min: number, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < min || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new CompanyOrganizationInputError(`${label} must contain ${min} to ${max} safe characters.`);
  }
  return normalized;
}

function normalizeWebsite(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 5 || normalized.length > 240) {
    throw new CompanyOrganizationInputError("Website must contain 5 to 240 characters.");
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new CompanyOrganizationInputError("Enter a valid Company website URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CompanyOrganizationInputError("Company website must use HTTP or HTTPS.");
  }
  parsed.hash = "";
  const result = parsed.toString();
  if (result.length > 240) {
    throw new CompanyOrganizationInputError("Company website exceeds 240 characters.");
  }
  return result;
}

function normalizeRegistrationNumber(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!normalized) return null;
  if (normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new CompanyOrganizationInputError("Company registration number exceeds 120 safe characters.");
  }
  return normalized;
}

export function normalizeCompanyUnitDraft(input: CompanyUnitDraftInput): NormalizedCompanyUnitDraft {
  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch {
    throw new CompanyOrganizationInputError("Enter a valid Company unit email address.");
  }
  return Object.freeze({
    name: normalizeText(input.name, "Name", 2, 160),
    formattedAddress: normalizeText(input.formattedAddress, "Address", 2, 500),
    phone: normalizeText(input.phone, "Phone", 3, 32),
    website: normalizeWebsite(input.website),
    email,
    registrationNumber: normalizeRegistrationNumber(input.registrationNumber)
  });
}

export function createCompanySiteId(): string {
  return createIdentifier("site");
}

export function createCompanyDepartmentId(): string {
  return createIdentifier("department");
}

export function normalizeCompanyUnitRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CompanyOrganizationInputError("Company unit revision is invalid.");
  }
  return value;
}
