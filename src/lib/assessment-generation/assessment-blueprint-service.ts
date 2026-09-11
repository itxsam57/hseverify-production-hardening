import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  AssessmentBlueprintAccessError,
  AssessmentBlueprintConflictError,
  AssessmentBlueprintInputError,
  BLUEPRINT_STATUSES,
  createBlueprintId,
  createBlueprintVersionId,
  normalizeBlueprintReference,
  normalizeBlueprintVersion,
  type BlueprintSelector,
  type BlueprintStatus,
  type BlueprintVersionInput,
  type NormalizedBlueprintVersion
} from "./assessment-blueprint-domain";

type BlueprintRow = {
  blueprint_id: string;
  blueprint_reference: string;
  blueprint_status: BlueprintStatus;
  current_version_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type BlueprintVersionRow = {
  blueprint_version_id: string;
  blueprint_id: string;
  version_no: number | string;
  framework_id: string;
  title: string;
  selectors_json: unknown;
  created_at: string | Date;
};

export type StoredAssessmentBlueprint = Readonly<{
  blueprintId: string;
  blueprintReference: string;
  blueprintStatus: BlueprintStatus;
  currentVersionId: string;
  createdAt: string;
  updatedAt: string;
}>;

export type StoredAssessmentBlueprintVersion = Readonly<{
  blueprintVersionId: string;
  blueprintId: string;
  versionNo: number;
  frameworkId: string;
  title: string;
  selectors: readonly BlueprintSelector[];
  totalCount: number;
  createdAt: string;
}>;

export type AssessmentBlueprintAdminListItem = Readonly<{
  blueprint: StoredAssessmentBlueprint;
  version: StoredAssessmentBlueprintVersion;
}>;

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function jsonArray(value: unknown): readonly BlueprintSelector[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new AssessmentBlueprintConflictError("Stored blueprint selector JSON is invalid.");
    }
  }
  if (!Array.isArray(parsed)) {
    throw new AssessmentBlueprintConflictError("Stored blueprint selectors are invalid.");
  }
  return Object.freeze(parsed as BlueprintSelector[]);
}

function toBlueprint(row: BlueprintRow): StoredAssessmentBlueprint {
  if (!row.current_version_id) {
    throw new AssessmentBlueprintConflictError("Blueprint current-version pointer is incomplete.");
  }
  return Object.freeze({
    blueprintId: row.blueprint_id,
    blueprintReference: row.blueprint_reference,
    blueprintStatus: row.blueprint_status,
    currentVersionId: row.current_version_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

function toVersion(row: BlueprintVersionRow): StoredAssessmentBlueprintVersion {
  const selectors = jsonArray(row.selectors_json);
  const totalCount = selectors.reduce((sum, selector) => sum + Number(selector.count), 0);
  if (!Number.isSafeInteger(totalCount) || totalCount < 1 || totalCount > 500) {
    throw new AssessmentBlueprintConflictError("Stored blueprint question count is invalid.");
  }
  return Object.freeze({
    blueprintVersionId: row.blueprint_version_id,
    blueprintId: row.blueprint_id,
    versionNo: Number(row.version_no),
    frameworkId: row.framework_id,
    title: row.title,
    selectors,
    totalCount,
    createdAt: iso(row.created_at)
  });
}

async function liveAdmin(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<void> {
  if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
    throw new AssessmentBlueprintAccessError();
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
  if (!result.rows[0]) throw new AssessmentBlueprintAccessError();
}

async function activeFrameworkId(
  database: DatabaseClient,
  reference: string
): Promise<string> {
  const result = await database.query<{ framework_id: string }>(
    `SELECT framework_id
     FROM assurance_frameworks
     WHERE framework_reference=$1 AND framework_status='ACTIVE'`,
    [reference]
  );
  if (!result.rows[0]) {
    throw new AssessmentBlueprintInputError("Assessment framework is unavailable.");
  }
  return result.rows[0].framework_id;
}

async function appendAudit(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  action:
    | "assessment.blueprint.created"
    | "assessment.blueprint.revised"
    | "assessment.blueprint.status.changed",
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
  blueprintId: string,
  versionNo: number,
  normalized: NormalizedBlueprintVersion,
  frameworkId: string,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<string> {
  const blueprintVersionId = createBlueprintVersionId();
  await database.query(
    `INSERT INTO assessment_blueprint_versions(
       blueprint_version_id,blueprint_id,version_no,framework_id,title,
       selectors_json,created_by_account_id,created_at
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
    [
      blueprintVersionId,
      blueprintId,
      versionNo,
      frameworkId,
      normalized.title,
      JSON.stringify(normalized.selectors),
      principal.accountId,
      now.toISOString()
    ]
  );
  return blueprintVersionId;
}

function mapConflict(error: unknown): never {
  if (
    error instanceof AssessmentBlueprintAccessError ||
    error instanceof AssessmentBlueprintInputError ||
    error instanceof AssessmentBlueprintConflictError
  ) {
    throw error;
  }
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "23505") {
    throw new AssessmentBlueprintConflictError(
      "Blueprint reference or revision conflicts with existing state."
    );
  }
  throw error;
}

function validBlueprintId(value: string): boolean {
  return /^assessment_blueprint_[A-Za-z0-9_-]{24}$/.test(value);
}

function validVersionId(value: string): boolean {
  return /^blueprint_version_[A-Za-z0-9_-]{24}$/.test(value);
}

export class AssessmentBlueprintService {
  constructor(private readonly database: DatabaseClient) {}

  async createBlueprint(
    principal: AuthorizationPrincipal,
    input: { blueprintReference: string; version: BlueprintVersionInput },
    now = new Date()
  ): Promise<AssessmentBlueprintAdminListItem> {
    const reference = normalizeBlueprintReference(input.blueprintReference);
    const normalized = normalizeBlueprintVersion(input.version);
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const frameworkId = await activeFrameworkId(database, normalized.frameworkReference);
        const blueprintId = createBlueprintId();
        await database.query(
          `INSERT INTO assessment_blueprints(
             blueprint_id,blueprint_reference,blueprint_status,
             created_by_account_id,created_at,updated_at
           ) VALUES($1,$2,'INACTIVE',$3,$4,$4)`,
          [blueprintId, reference, principal.accountId, now.toISOString()]
        );
        const blueprintVersionId = await insertVersion(
          database,
          blueprintId,
          1,
          normalized,
          frameworkId,
          principal,
          now
        );
        const updated = await database.query<BlueprintRow>(
          `UPDATE assessment_blueprints
           SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3
           WHERE blueprint_id=$1
           RETURNING blueprint_id,blueprint_reference,blueprint_status,
                     current_version_id,created_at,updated_at`,
          [blueprintId, blueprintVersionId, now.toISOString()]
        );
        const version = await this.findVersion(database, blueprintVersionId);
        if (!updated.rows[0] || !version) throw new AssessmentBlueprintConflictError();
        await appendAudit(database, principal, "assessment.blueprint.created", blueprintId, {
          versionNo: 1,
          frameworkId,
          questionCount: normalized.totalCount
        });
        return Object.freeze({ blueprint: toBlueprint(updated.rows[0]), version: toVersion(version) });
      });
    } catch (error) {
      return mapConflict(error);
    }
  }

  async reviseBlueprint(
    principal: AuthorizationPrincipal,
    input: {
      blueprintId: string;
      expectedCurrentVersionId: string;
      version: BlueprintVersionInput;
    },
    now = new Date()
  ): Promise<AssessmentBlueprintAdminListItem> {
    const blueprintId = input.blueprintId.trim();
    const expected = input.expectedCurrentVersionId.trim();
    const normalized = normalizeBlueprintVersion(input.version);
    if (!validBlueprintId(blueprintId) || !validVersionId(expected)) {
      throw new AssessmentBlueprintInputError("Blueprint revision reference is invalid.");
    }
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const current = await database.query<BlueprintRow>(
          `SELECT blueprint_id,blueprint_reference,blueprint_status,current_version_id,
                  created_at,updated_at
           FROM assessment_blueprints
           WHERE blueprint_id=$1
           FOR UPDATE`,
          [blueprintId]
        );
        const currentRow = current.rows[0];
        if (!currentRow) throw new AssessmentBlueprintAccessError();
        if (currentRow.current_version_id !== expected) {
          throw new AssessmentBlueprintConflictError(
            "Blueprint was revised by another writer."
          );
        }
        const frameworkId = await activeFrameworkId(database, normalized.frameworkReference);
        const next = await database.query<{ version_no: number | string }>(
          `SELECT COALESCE(MAX(version_no),0)+1 AS version_no
           FROM assessment_blueprint_versions
           WHERE blueprint_id=$1`,
          [blueprintId]
        );
        const versionNo = Number(next.rows[0]?.version_no ?? 1);
        const blueprintVersionId = await insertVersion(
          database,
          blueprintId,
          versionNo,
          normalized,
          frameworkId,
          principal,
          now
        );
        const updated = await database.query<BlueprintRow>(
          `UPDATE assessment_blueprints
           SET current_version_id=$2,updated_at=$3
           WHERE blueprint_id=$1 AND current_version_id=$4
           RETURNING blueprint_id,blueprint_reference,blueprint_status,
                     current_version_id,created_at,updated_at`,
          [blueprintId, blueprintVersionId, now.toISOString(), expected]
        );
        if (!updated.rows[0]) {
          throw new AssessmentBlueprintConflictError(
            "Blueprint was revised by another writer."
          );
        }
        const version = await this.findVersion(database, blueprintVersionId);
        if (!version) throw new AssessmentBlueprintConflictError();
        await appendAudit(database, principal, "assessment.blueprint.revised", blueprintId, {
          versionNo,
          frameworkId,
          questionCount: normalized.totalCount
        });
        return Object.freeze({ blueprint: toBlueprint(updated.rows[0]), version: toVersion(version) });
      });
    } catch (error) {
      return mapConflict(error);
    }
  }

  async setStatus(
    principal: AuthorizationPrincipal,
    blueprintIdInput: string,
    status: BlueprintStatus,
    now = new Date()
  ): Promise<StoredAssessmentBlueprint> {
    const blueprintId = blueprintIdInput.trim();
    if (!validBlueprintId(blueprintId) || !BLUEPRINT_STATUSES.includes(status)) {
      throw new AssessmentBlueprintInputError("Blueprint status change is invalid.");
    }
    try {
      return await this.database.transaction(async (database) => {
        await liveAdmin(database, principal, now);
        const updated = await database.query<BlueprintRow>(
          `UPDATE assessment_blueprints
           SET blueprint_status=$2,updated_at=$3
           WHERE blueprint_id=$1 AND current_version_id IS NOT NULL
           RETURNING blueprint_id,blueprint_reference,blueprint_status,
                     current_version_id,created_at,updated_at`,
          [blueprintId, status, now.toISOString()]
        );
        if (!updated.rows[0]) throw new AssessmentBlueprintAccessError();
        await appendAudit(
          database,
          principal,
          "assessment.blueprint.status.changed",
          blueprintId,
          { status }
        );
        return toBlueprint(updated.rows[0]);
      });
    } catch (error) {
      return mapConflict(error);
    }
  }

  async listBlueprints(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<readonly AssessmentBlueprintAdminListItem[]> {
    return this.database.transaction(async (database) => {
      await liveAdmin(database, principal, now);
      const result = await database.query<BlueprintRow & BlueprintVersionRow>(
        `SELECT b.blueprint_id,b.blueprint_reference,b.blueprint_status,b.current_version_id,
                b.created_at,b.updated_at,
                v.blueprint_version_id,v.version_no,v.framework_id,v.title,v.selectors_json,
                v.created_at AS version_created_at
         FROM assessment_blueprints b
         JOIN assessment_blueprint_versions v ON v.blueprint_version_id=b.current_version_id
         ORDER BY b.updated_at DESC,b.blueprint_id`
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            blueprint: toBlueprint(row),
            version: toVersion({
              blueprint_version_id: row.blueprint_version_id,
              blueprint_id: row.blueprint_id,
              version_no: row.version_no,
              framework_id: row.framework_id,
              title: row.title,
              selectors_json: row.selectors_json,
              created_at: (row as unknown as { version_created_at: string | Date }).version_created_at
            })
          })
        )
      );
    });
  }

  private async findVersion(
    database: DatabaseClient,
    blueprintVersionId: string
  ): Promise<BlueprintVersionRow | null> {
    const result = await database.query<BlueprintVersionRow>(
      `SELECT blueprint_version_id,blueprint_id,version_no,framework_id,title,
              selectors_json,created_at
       FROM assessment_blueprint_versions
       WHERE blueprint_version_id=$1`,
      [blueprintVersionId]
    );
    return result.rows[0] ?? null;
  }
}

export async function getAssessmentBlueprintService(): Promise<AssessmentBlueprintService> {
  return new AssessmentBlueprintService(await getDatabaseClient());
}
