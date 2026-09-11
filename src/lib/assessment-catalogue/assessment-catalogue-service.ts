import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  AssessmentCatalogueAccessError,
  AssessmentCatalogueConflictError,
  AssessmentCatalogueInputError,
  CATALOGUE_STATUSES,
  createCatalogueEntryId,
  createCatalogueVersionId,
  normalizeCatalogueReference,
  normalizeCatalogueVersion,
  type CatalogueStatus,
  type CatalogueVersionInput,
  type NormalizedCatalogueVersion
} from "./assessment-catalogue-domain";

type CatalogueEntryRow = {
  catalogue_entry_id: string;
  catalogue_reference: string;
  catalogue_status: CatalogueStatus;
  current_version_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type CatalogueVersionRow = {
  catalogue_version_id: string;
  catalogue_entry_id: string;
  version_no: number | string;
  title: string;
  description: string | null;
  framework_id: string;
  blueprint_version_id: string;
  minimum_verified_qualifications: number | string;
  created_at: string | Date;
};

export type StoredAssessmentCatalogueEntry = Readonly<{
  catalogueEntryId: string;
  catalogueReference: string;
  catalogueStatus: CatalogueStatus;
  currentVersionId: string;
  createdAt: string;
  updatedAt: string;
}>;

export type StoredAssessmentCatalogueVersion = Readonly<{
  catalogueVersionId: string;
  catalogueEntryId: string;
  versionNo: number;
  title: string;
  description: string | null;
  frameworkId: string;
  blueprintVersionId: string;
  minimumVerifiedQualifications: number;
  createdAt: string;
}>;

export type AssessmentCatalogueAdminListItem = Readonly<{
  entry: StoredAssessmentCatalogueEntry;
  version: StoredAssessmentCatalogueVersion;
}>;

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function toEntry(row: CatalogueEntryRow): StoredAssessmentCatalogueEntry {
  if (!row.current_version_id) {
    throw new AssessmentCatalogueConflictError("Catalogue current-version pointer is incomplete.");
  }
  return Object.freeze({
    catalogueEntryId: row.catalogue_entry_id,
    catalogueReference: row.catalogue_reference,
    catalogueStatus: row.catalogue_status,
    currentVersionId: row.current_version_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

function toVersion(row: CatalogueVersionRow): StoredAssessmentCatalogueVersion {
  const versionNo = Number(row.version_no);
  const minimum = Number(row.minimum_verified_qualifications);
  if (!Number.isSafeInteger(versionNo) || versionNo < 1) {
    throw new AssessmentCatalogueConflictError("Stored catalogue version number is invalid.");
  }
  if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > 50) {
    throw new AssessmentCatalogueConflictError("Stored catalogue qualification minimum is invalid.");
  }
  return Object.freeze({
    catalogueVersionId: row.catalogue_version_id,
    catalogueEntryId: row.catalogue_entry_id,
    versionNo,
    title: row.title,
    description: row.description,
    frameworkId: row.framework_id,
    blueprintVersionId: row.blueprint_version_id,
    minimumVerifiedQualifications: minimum,
    createdAt: iso(row.created_at)
  });
}

async function liveAdmin(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<void> {
  if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
    throw new AssessmentCatalogueAccessError();
  }
  const result = await database.query(
    `SELECT 1
     FROM auth_sessions s
     JOIN auth_accounts a ON a.account_id=s.account_id
     JOIN auth_account_roles r ON r.account_id=a.account_id AND r.role='admin'
     WHERE s.session_id=$1
       AND s.account_id=$2
       AND s.active_role='admin'
       AND s.revoked_at IS NULL
       AND s.expires_at>$3
       AND a.account_status='active'
     FOR UPDATE OF s,a`,
    [principal.sessionId, principal.accountId, now.toISOString()]
  );
  if (!result.rows[0]) throw new AssessmentCatalogueAccessError();
}

async function resolveActiveBlueprintPin(
  database: DatabaseClient,
  normalized: NormalizedCatalogueVersion
): Promise<string> {
  const result = await database.query<{ framework_id: string }>(
    `SELECT f.framework_id
     FROM assurance_frameworks f
     JOIN assessment_blueprint_versions v
       ON v.framework_id=f.framework_id
      AND v.blueprint_version_id=$2
     JOIN assessment_blueprints b
       ON b.blueprint_id=v.blueprint_id
     WHERE f.framework_reference=$1
       AND f.framework_status='ACTIVE'
       AND b.blueprint_status='ACTIVE'`,
    [normalized.frameworkReference, normalized.blueprintVersionId]
  );
  if (!result.rows[0]) {
    throw new AssessmentCatalogueInputError(
      "Assessment framework or exact active blueprint version is unavailable."
    );
  }
  return result.rows[0].framework_id;
}

async function appendAudit(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  action:
    | "assessment.catalogue.created"
    | "assessment.catalogue.revised"
    | "assessment.catalogue.status.changed",
  reference: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await new DatabaseAuditRepository(Promise.resolve(database)).append(
    bindTrustedAuditActor(principal),
    {
      action,
      outcome: "succeeded",
      target: { type: "resource", reference },
      metadata
    }
  );
}

async function insertVersion(
  database: DatabaseClient,
  catalogueEntryId: string,
  versionNo: number,
  normalized: NormalizedCatalogueVersion,
  frameworkId: string,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<string> {
  const catalogueVersionId = createCatalogueVersionId();
  await database.query(
    `INSERT INTO assessment_catalogue_versions(
       catalogue_version_id,catalogue_entry_id,version_no,title,description,
       framework_id,blueprint_version_id,minimum_verified_qualifications,
       created_by_account_id,created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      catalogueVersionId,
      catalogueEntryId,
      versionNo,
      normalized.title,
      normalized.description,
      frameworkId,
      normalized.blueprintVersionId,
      normalized.minimumVerifiedQualifications,
      principal.accountId,
      now.toISOString()
    ]
  );
  return catalogueVersionId;
}

function mapConflict(error: unknown): never {
  if (
    error instanceof AssessmentCatalogueAccessError ||
    error instanceof AssessmentCatalogueInputError ||
    error instanceof AssessmentCatalogueConflictError
  ) {
    throw error;
  }
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "23505") {
    throw new AssessmentCatalogueConflictError(
      "Catalogue reference or revision conflicts with existing state."
    );
  }
  throw error;
}

function validEntryId(value: string): boolean {
  return /^assessment_catalogue_[A-Za-z0-9_-]{24}$/.test(value);
}

function validVersionId(value: string): boolean {
  return /^catalogue_version_[A-Za-z0-9_-]{24}$/.test(value);
}

export class AssessmentCatalogueService {
  constructor(private readonly database: DatabaseClient) {}

  async createEntry(
    principal: AuthorizationPrincipal,
    input: { catalogueReference: string; version: CatalogueVersionInput },
    now = new Date()
  ): Promise<AssessmentCatalogueAdminListItem> {
    const reference = normalizeCatalogueReference(input.catalogueReference);
    const normalized = normalizeCatalogueVersion(input.version);
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const frameworkId = await resolveActiveBlueprintPin(database, normalized);
        const catalogueEntryId = createCatalogueEntryId();
        await database.query(
          `INSERT INTO assessment_catalogue_entries(
             catalogue_entry_id,catalogue_reference,catalogue_status,
             created_by_account_id,created_at,updated_at
           ) VALUES($1,$2,'INACTIVE',$3,$4,$4)`,
          [catalogueEntryId, reference, principal.accountId, now.toISOString()]
        );
        const catalogueVersionId = await insertVersion(
          database,
          catalogueEntryId,
          1,
          normalized,
          frameworkId,
          principal,
          now
        );
        const updated = await database.query<CatalogueEntryRow>(
          `UPDATE assessment_catalogue_entries
           SET current_version_id=$2,catalogue_status='ACTIVE',updated_at=$3
           WHERE catalogue_entry_id=$1
           RETURNING catalogue_entry_id,catalogue_reference,catalogue_status,
                     current_version_id,created_at,updated_at`,
          [catalogueEntryId, catalogueVersionId, now.toISOString()]
        );
        const version = await this.findVersion(database, catalogueVersionId);
        if (!updated.rows[0] || !version) throw new AssessmentCatalogueConflictError();
        await appendAudit(database, principal, "assessment.catalogue.created", catalogueEntryId, {
          versionNo: 1,
          frameworkId,
          blueprintVersionId: normalized.blueprintVersionId,
          minimumVerifiedQualifications: normalized.minimumVerifiedQualifications
        });
        return Object.freeze({ entry: toEntry(updated.rows[0]), version: toVersion(version) });
      });
    } catch (error) {
      return mapConflict(error);
    }
  }

  async reviseEntry(
    principal: AuthorizationPrincipal,
    input: {
      catalogueEntryId: string;
      expectedCurrentVersionId: string;
      version: CatalogueVersionInput;
    },
    now = new Date()
  ): Promise<AssessmentCatalogueAdminListItem> {
    const catalogueEntryId = input.catalogueEntryId.trim();
    const expected = input.expectedCurrentVersionId.trim();
    const normalized = normalizeCatalogueVersion(input.version);
    if (!validEntryId(catalogueEntryId) || !validVersionId(expected)) {
      throw new AssessmentCatalogueInputError("Catalogue revision reference is invalid.");
    }
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const current = await database.query<CatalogueEntryRow>(
          `SELECT catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,
                  created_at,updated_at
           FROM assessment_catalogue_entries
           WHERE catalogue_entry_id=$1
           FOR UPDATE`,
          [catalogueEntryId]
        );
        const currentRow = current.rows[0];
        if (!currentRow) throw new AssessmentCatalogueAccessError();
        if (currentRow.current_version_id !== expected) {
          throw new AssessmentCatalogueConflictError("Catalogue was revised by another writer.");
        }
        const frameworkId = await resolveActiveBlueprintPin(database, normalized);
        const next = await database.query<{ version_no: number | string }>(
          `SELECT COALESCE(MAX(version_no),0)+1 AS version_no
           FROM assessment_catalogue_versions
           WHERE catalogue_entry_id=$1`,
          [catalogueEntryId]
        );
        const versionNo = Number(next.rows[0]?.version_no ?? 1);
        const catalogueVersionId = await insertVersion(
          database,
          catalogueEntryId,
          versionNo,
          normalized,
          frameworkId,
          principal,
          now
        );
        const updated = await database.query<CatalogueEntryRow>(
          `UPDATE assessment_catalogue_entries
           SET current_version_id=$2,updated_at=$3
           WHERE catalogue_entry_id=$1 AND current_version_id=$4
           RETURNING catalogue_entry_id,catalogue_reference,catalogue_status,
                     current_version_id,created_at,updated_at`,
          [catalogueEntryId, catalogueVersionId, now.toISOString(), expected]
        );
        if (!updated.rows[0]) {
          throw new AssessmentCatalogueConflictError("Catalogue was revised by another writer.");
        }
        const version = await this.findVersion(database, catalogueVersionId);
        if (!version) throw new AssessmentCatalogueConflictError();
        await appendAudit(database, principal, "assessment.catalogue.revised", catalogueEntryId, {
          versionNo,
          frameworkId,
          blueprintVersionId: normalized.blueprintVersionId,
          minimumVerifiedQualifications: normalized.minimumVerifiedQualifications
        });
        return Object.freeze({ entry: toEntry(updated.rows[0]), version: toVersion(version) });
      });
    } catch (error) {
      return mapConflict(error);
    }
  }

  async setStatus(
    principal: AuthorizationPrincipal,
    catalogueEntryIdInput: string,
    status: CatalogueStatus,
    now = new Date()
  ): Promise<StoredAssessmentCatalogueEntry> {
    const catalogueEntryId = catalogueEntryIdInput.trim();
    if (!validEntryId(catalogueEntryId) || !CATALOGUE_STATUSES.includes(status)) {
      throw new AssessmentCatalogueInputError("Catalogue status change is invalid.");
    }
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const updated = await database.query<CatalogueEntryRow>(
          `UPDATE assessment_catalogue_entries
           SET catalogue_status=$2,updated_at=$3
           WHERE catalogue_entry_id=$1 AND current_version_id IS NOT NULL
           RETURNING catalogue_entry_id,catalogue_reference,catalogue_status,
                     current_version_id,created_at,updated_at`,
          [catalogueEntryId, status, now.toISOString()]
        );
        if (!updated.rows[0]) throw new AssessmentCatalogueAccessError();
        await appendAudit(
          database,
          principal,
          "assessment.catalogue.status.changed",
          catalogueEntryId,
          { status }
        );
        return toEntry(updated.rows[0]);
      });
    } catch (error) {
      return mapConflict(error);
    }
  }

  async listEntries(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<readonly AssessmentCatalogueAdminListItem[]> {
    return this.database.transaction(async (database) => {
      await liveAdmin(database, principal, now);
      const result = await database.query<
        CatalogueEntryRow & CatalogueVersionRow & { version_created_at: string | Date }
      >(
        `SELECT e.catalogue_entry_id,e.catalogue_reference,e.catalogue_status,e.current_version_id,
                e.created_at,e.updated_at,
                v.catalogue_version_id,v.version_no,v.title,v.description,v.framework_id,
                v.blueprint_version_id,v.minimum_verified_qualifications,
                v.created_at AS version_created_at
         FROM assessment_catalogue_entries e
         JOIN assessment_catalogue_versions v
           ON v.catalogue_entry_id=e.catalogue_entry_id
          AND v.catalogue_version_id=e.current_version_id
         ORDER BY e.updated_at DESC,e.catalogue_entry_id`
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            entry: toEntry(row),
            version: toVersion({
              catalogue_version_id: row.catalogue_version_id,
              catalogue_entry_id: row.catalogue_entry_id,
              version_no: row.version_no,
              title: row.title,
              description: row.description,
              framework_id: row.framework_id,
              blueprint_version_id: row.blueprint_version_id,
              minimum_verified_qualifications: row.minimum_verified_qualifications,
              created_at: row.version_created_at
            })
          })
        )
      );
    });
  }

  private async findVersion(
    database: DatabaseClient,
    catalogueVersionId: string
  ): Promise<CatalogueVersionRow | null> {
    const result = await database.query<CatalogueVersionRow>(
      `SELECT catalogue_version_id,catalogue_entry_id,version_no,title,description,
              framework_id,blueprint_version_id,minimum_verified_qualifications,created_at
       FROM assessment_catalogue_versions
       WHERE catalogue_version_id=$1`,
      [catalogueVersionId]
    );
    return result.rows[0] ?? null;
  }
}

export async function getAssessmentCatalogueService(): Promise<AssessmentCatalogueService> {
  return new AssessmentCatalogueService(await getDatabaseClient());
}
