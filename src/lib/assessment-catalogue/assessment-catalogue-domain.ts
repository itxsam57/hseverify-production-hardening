import { createIdentifier } from "../auth/auth-domain";

export const CATALOGUE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

export type CatalogueVersionInput = Readonly<{
  title: string;
  description?: string | null;
  frameworkReference: string;
  blueprintVersionId: string;
  minimumVerifiedQualifications?: number;
}>;

export type NormalizedCatalogueVersion = Readonly<{
  title: string;
  description: string | null;
  frameworkReference: string;
  blueprintVersionId: string;
  minimumVerifiedQualifications: number;
}>;

export class AssessmentCatalogueInputError extends Error {
  constructor(message = "Assessment catalogue input is invalid.") {
    super(message);
    this.name = "AssessmentCatalogueInputError";
  }
}

export class AssessmentCatalogueAccessError extends Error {
  constructor(message = "The assessment catalogue could not be accessed.") {
    super(message);
    this.name = "AssessmentCatalogueAccessError";
  }
}

export class AssessmentCatalogueConflictError extends Error {
  constructor(message = "Assessment catalogue state changed or conflicts with another entry.") {
    super(message);
    this.name = "AssessmentCatalogueConflictError";
  }
}

export const createCatalogueEntryId = (): string => createIdentifier("assessment_catalogue");
export const createCatalogueVersionId = (): string => createIdentifier("catalogue_version");

export function normalizeCatalogueReference(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/^[A-Z0-9][A-Z0-9._:/-]*$/.test(normalized)
  ) {
    throw new AssessmentCatalogueInputError("Catalogue reference is invalid.");
  }
  return normalized;
}

function normalizeTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 200) {
    throw new AssessmentCatalogueInputError("Catalogue title is invalid.");
  }
  return normalized;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (normalized.length > 2000) {
    throw new AssessmentCatalogueInputError("Catalogue description is invalid.");
  }
  return normalized;
}

function normalizeFrameworkReference(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/^[A-Z0-9][A-Z0-9._:/-]*$/.test(normalized)
  ) {
    throw new AssessmentCatalogueInputError("Catalogue framework reference is invalid.");
  }
  return normalized;
}

function normalizeBlueprintVersionId(value: string): string {
  const normalized = value.trim();
  if (!/^blueprint_version_[A-Za-z0-9_-]{24}$/.test(normalized)) {
    throw new AssessmentCatalogueInputError("Catalogue blueprint version reference is invalid.");
  }
  return normalized;
}

export function normalizeCatalogueVersion(
  input: CatalogueVersionInput
): NormalizedCatalogueVersion {
  const minimum = input.minimumVerifiedQualifications ?? 1;
  if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > 50) {
    throw new AssessmentCatalogueInputError(
      "Minimum verified qualifications must be an integer from 0 to 50."
    );
  }
  return Object.freeze({
    title: normalizeTitle(input.title),
    description: normalizeDescription(input.description),
    frameworkReference: normalizeFrameworkReference(input.frameworkReference),
    blueprintVersionId: normalizeBlueprintVersionId(input.blueprintVersionId),
    minimumVerifiedQualifications: minimum
  });
}
