import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";

export class AssessmentCatalogueEligibilityAccessError extends Error {
  constructor(message = "Assessment availability could not be accessed.") {
    super(message);
    this.name = "AssessmentCatalogueEligibilityAccessError";
  }
}

export type AssessmentCatalogueAvailability = Readonly<{
  catalogueEntryId: string;
  catalogueVersionId: string;
  catalogueReference: string;
  title: string;
  description: string | null;
  frameworkId: string;
  blueprintVersionId: string;
  minimumVerifiedQualifications: number;
  verifiedQualificationCount: number;
  caseId: string;
}>;

type AvailabilityRow = {
  catalogue_entry_id: string;
  catalogue_version_id: string;
  catalogue_reference: string;
  title: string;
  description: string | null;
  framework_id: string;
  blueprint_version_id: string;
  minimum_verified_qualifications: number | string;
  verified_qualification_count: number | string;
  case_id: string;
};

const CASE_ID_PATTERN = /^assurance_case_[A-Za-z0-9_-]{24}$/;

async function assertLiveWorker(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  now: Date
): Promise<void> {
  const permission = evaluatePlatformPermission({
    role: principal.activeRole,
    permission: "worker.assessments.read"
  });
  if (
    principal.activeRole !== "worker" ||
    principal.accountStatus !== "active" ||
    !permission.allowed
  ) {
    throw new AssessmentCatalogueEligibilityAccessError();
  }

  const current = await database.query<{ session_id: string }>(
    `SELECT s.session_id
     FROM auth_sessions AS s
     JOIN auth_accounts AS a
       ON a.account_id = s.account_id
     JOIN auth_account_roles AS r
       ON r.account_id = a.account_id
      AND r.role = 'worker'
     WHERE s.session_id = $1
       AND s.account_id = $2
       AND s.active_role = 'worker'
       AND s.revoked_at IS NULL
       AND s.expires_at > $3
       AND a.account_status = 'active'
     LIMIT 1`,
    [principal.sessionId, principal.accountId, now.toISOString()]
  );
  if (current.rows[0]?.session_id !== principal.sessionId) {
    throw new AssessmentCatalogueEligibilityAccessError();
  }
}

function toAvailability(row: AvailabilityRow): AssessmentCatalogueAvailability {
  const minimum = Number(row.minimum_verified_qualifications);
  const verified = Number(row.verified_qualification_count);
  if (
    !Number.isSafeInteger(minimum) ||
    minimum < 0 ||
    minimum > 50 ||
    !Number.isSafeInteger(verified) ||
    verified < 0
  ) {
    throw new AssessmentCatalogueEligibilityAccessError();
  }

  return Object.freeze({
    catalogueEntryId: row.catalogue_entry_id,
    catalogueVersionId: row.catalogue_version_id,
    catalogueReference: row.catalogue_reference,
    title: row.title,
    description: row.description,
    frameworkId: row.framework_id,
    blueprintVersionId: row.blueprint_version_id,
    minimumVerifiedQualifications: minimum,
    verifiedQualificationCount: verified,
    caseId: row.case_id
  });
}

function availabilitySql(forCase: boolean): string {
  return `WITH verified_qualification_count AS (
    SELECT
      records.worker_account_id,
      COUNT(DISTINCT records.record_id)::int AS qualification_count
    FROM worker_evidence_records AS records
    JOIN worker_evidence_versions AS versions
      ON versions.version_id = records.current_version_id
     AND versions.record_id = records.record_id
     AND versions.version_status = 'submitted'
    JOIN evidence_review_tasks AS tasks
      ON tasks.source_record_id = records.record_id
     AND tasks.source_version_id = records.current_version_id
     AND tasks.worker_account_id = records.worker_account_id
     AND tasks.evidence_kind = 'qualification'
     AND tasks.task_status = 'APPROVED'
    JOIN evidence_review_decisions AS decisions
      ON decisions.task_id = tasks.task_id
     AND decisions.source_version_id = tasks.source_version_id
     AND decisions.outcome = 'APPROVED'
    WHERE records.worker_account_id = $1
      AND records.record_kind = 'qualification'
    GROUP BY records.worker_account_id
  )
  SELECT
    entries.catalogue_entry_id,
    versions.catalogue_version_id,
    entries.catalogue_reference,
    versions.title,
    versions.description,
    versions.framework_id,
    versions.blueprint_version_id,
    versions.minimum_verified_qualifications,
    COALESCE(qualifications.qualification_count, 0)::int AS verified_qualification_count,
    cases.case_id
  FROM assurance_cases AS cases
  JOIN assurance_case_policy_snapshots AS snapshots
    ON snapshots.case_id = cases.case_id
  JOIN assessment_catalogue_entries AS entries
    ON entries.catalogue_status = 'ACTIVE'
   AND entries.current_version_id IS NOT NULL
  JOIN assessment_catalogue_versions AS versions
    ON versions.catalogue_entry_id = entries.catalogue_entry_id
   AND versions.catalogue_version_id = entries.current_version_id
   AND versions.framework_id = snapshots.framework_id
  JOIN assessment_blueprint_versions AS blueprint_versions
    ON blueprint_versions.blueprint_version_id = versions.blueprint_version_id
   AND blueprint_versions.framework_id = versions.framework_id
  JOIN assessment_blueprints AS blueprints
    ON blueprints.blueprint_id = blueprint_versions.blueprint_id
   AND blueprints.blueprint_status = 'ACTIVE'
  LEFT JOIN verified_qualification_count AS qualifications
    ON qualifications.worker_account_id = cases.worker_account_id
  WHERE cases.worker_account_id = $1
    AND cases.case_status = 'Assessment pending'
    ${forCase ? "AND cases.case_id = $2" : ""}
    AND COALESCE(qualifications.qualification_count, 0) >= versions.minimum_verified_qualifications
  ORDER BY cases.created_at, cases.case_id, entries.catalogue_reference, entries.catalogue_entry_id`;
}

export class AssessmentCatalogueEligibilityService {
  constructor(private readonly database: DatabaseClient) {}

  async listAvailableForWorker(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<readonly AssessmentCatalogueAvailability[]> {
    await assertLiveWorker(this.database, principal, now);
    const result = await this.database.query<AvailabilityRow>(
      availabilitySql(false),
      [principal.accountId]
    );
    return Object.freeze(result.rows.map(toAvailability));
  }

  async findAvailableForCase(
    principal: AuthorizationPrincipal,
    caseIdInput: string,
    now = new Date()
  ): Promise<readonly AssessmentCatalogueAvailability[]> {
    await assertLiveWorker(this.database, principal, now);
    const caseId = caseIdInput.trim();
    if (!CASE_ID_PATTERN.test(caseId)) return Object.freeze([]);

    const result = await this.database.query<AvailabilityRow>(
      availabilitySql(true),
      [principal.accountId, caseId]
    );
    return Object.freeze(result.rows.map(toAvailability));
  }
}

let service: AssessmentCatalogueEligibilityService | null = null;

export async function getAssessmentCatalogueEligibilityService(): Promise<AssessmentCatalogueEligibilityService> {
  service ??= new AssessmentCatalogueEligibilityService(await getDatabaseClient());
  return service;
}
