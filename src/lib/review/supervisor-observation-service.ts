import "server-only";
import { EvidenceReviewService } from "./evidence-review-service";

import { TENANT_COMMAND_SCOPE_SQL } from "@/lib/authorization/tenant-scoped-command-guard";

import { createIdentifier } from "@/lib/auth/auth-domain";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import type { TenantPermissionPrincipal } from "@/lib/authorization/tenant-scoped-resource-domain";
import { deriveTrustedTenantScope } from "@/lib/authorization/tenant-scoped-resource-domain";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";

export type SupervisorObservationCreatePrincipal =
  TenantPermissionPrincipal<"company.orders.manage">;

export type SupervisorOption = Readonly<{
  membershipId: string;
  displayName: string;
  role: string;
}>;

export type ObservationCaseOption = Readonly<{
  caseId: string;
  workerAccountId: string;
  workerName: string;
  caseStatus: string;
}>;

export type WorkerObservationView = Readonly<{
  observationId: string;
  competencyReference: string;
  frameworkReference: string;
  taskReference: string;
  observedAt: string;
  observationText: string;
  outcome: string;
  restrictions: string | null;
  supervisorName: string;
  supervisorSignedAt: string | null;
  workerAcknowledgedAt: string | null;
  workerComment: string | null;
  checklist: readonly string[];
  supervisorDeclaration: string | null;
  reviewStatus: string | null;
  reviewReason: string | null;
}>;

export class SupervisorObservationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorObservationInputError";
  }
}

function text(value: string, label: string, min: number, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < min || normalized.length > max) {
    throw new SupervisorObservationInputError(`${label} must contain between ${min} and ${max} characters.`);
  }
  return normalized;
}

async function liveCompany(db: DatabaseClient, principal: SupervisorObservationCreatePrincipal): Promise<void> {
  const scope = deriveTrustedTenantScope(principal);
  if (principal.authorizedTenantPermission !== "company.orders.manage") throw new SupervisorObservationInputError("Company access is required.");
  const live = await db.query(TENANT_COMMAND_SCOPE_SQL.replace("sessions.expires_at > $5::timestamptz", "sessions.expires_at > clock_timestamp() AND $5::timestamptz IS NOT NULL").replace("FOR UPDATE OF memberships, tenants, accounts, sessions", "FOR UPDATE OF memberships, tenants, accounts, sessions, account_roles, ceiling"),
    [scope.membershipId, scope.tenantId, scope.accountId, scope.sessionId, new Date().toISOString(), "company.orders.manage"]);
  if (!live.rows[0]) throw new SupervisorObservationInputError("Company access is unavailable.");
}

async function liveWorker(db: DatabaseClient, principal: AuthorizationPrincipal): Promise<void> {
  if (principal.activeRole !== "worker" || principal.accountStatus !== "active") throw new SupervisorObservationInputError("Worker access is required.");
  const live = await db.query(`SELECT 1 FROM auth_sessions sessions
    JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id
    JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='worker'
    WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role='worker'
      AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp() AND accounts.account_status='active'
    FOR UPDATE OF sessions,accounts,roles`, [principal.sessionId,principal.accountId]);
  if (!live.rows[0]) throw new SupervisorObservationInputError("Worker access is unavailable.");
}

export class SupervisorObservationService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async listCompanyContext(principal: SupervisorObservationCreatePrincipal): Promise<{
    supervisors: readonly SupervisorOption[];
    cases: readonly ObservationCaseOption[];
  }> {
    const scope = deriveTrustedTenantScope(principal);
    const db = await this.databasePromise;
    return db.transaction(async (db) => {
    await liveCompany(db, principal);
    const [supervisors, cases] = await Promise.all([
      db.query<{ membership_id: string; display_name: string; membership_role: string }>(
        `SELECT memberships.membership_id,accounts.display_name,memberships.membership_role
           FROM auth_tenant_memberships AS memberships
           JOIN auth_accounts AS accounts ON accounts.account_id=memberships.account_id
          WHERE memberships.tenant_id=$1 AND memberships.membership_id=$2 AND memberships.account_id=$3
            AND memberships.portal_role='company'
            AND memberships.membership_status='active'
            AND accounts.account_status='active'
          ORDER BY accounts.display_name,memberships.membership_id`,
        [scope.tenantId, scope.membershipId, scope.accountId]
      ),
      db.query<{ case_id: string; worker_account_id: string; display_name: string; case_status: string }>(
        `SELECT cases.case_id,cases.worker_account_id,accounts.display_name,cases.case_status
           FROM assurance_cases AS cases
           JOIN auth_accounts AS accounts ON accounts.account_id=cases.worker_account_id
          WHERE cases.tenant_id=$1
            AND cases.case_status NOT IN ('Closed','Rejected','Issued') AND cases.closed_at IS NULL
          ORDER BY accounts.display_name,cases.updated_at DESC`,
        [scope.tenantId]
      )
    ]);
    return {
      supervisors: Object.freeze(supervisors.rows.map((row) => Object.freeze({
        membershipId: row.membership_id,
        displayName: row.display_name,
        role: row.membership_role
      }))),
      cases: Object.freeze(cases.rows.map((row) => Object.freeze({
        caseId: row.case_id,
        workerAccountId: row.worker_account_id,
        workerName: row.display_name,
        caseStatus: row.case_status
      })))
    };
    });
  }

  async create(
    principal: SupervisorObservationCreatePrincipal,
    input: {
      caseId: string;
      observerMembershipId: string;
      frameworkReference: string;
      competencyReference: string;
      taskReference: string;
      checklist: readonly string[];
      restrictions?: string | null;
      observationText: string;
      outcome: "demonstrated" | "partially_demonstrated" | "not_demonstrated";
      supervisorDeclaration: string;
      observedAt: Date;
    }
  ): Promise<string> {
    const scope = deriveTrustedTenantScope(principal);
    const framework = text(input.frameworkReference, "Framework reference", 2, 180);
    const competency = text(input.competencyReference, "Competency reference", 2, 160);
    const task = text(input.taskReference, "Observed task", 2, 240);
    const observation = text(input.observationText, "Observation", 20, 6000);
    const declaration = text(input.supervisorDeclaration, "Supervisor declaration", 10, 1000);
    const restrictions = input.restrictions?.trim() || null;
    if (restrictions && restrictions.length > 2000) throw new SupervisorObservationInputError("Restrictions exceed 2000 characters.");
    if (input.checklist.length > 40 || input.checklist.some(item => item.trim().length > 240)) throw new SupervisorObservationInputError("Checklist exceeds the allowed size.");
    const checklist = input.checklist.map(item => item.trim()).filter(Boolean);
    if (!["demonstrated", "partially_demonstrated", "not_demonstrated"].includes(input.outcome)) {
      throw new SupervisorObservationInputError("Observation outcome is invalid.");
    }
    if (!Number.isFinite(input.observedAt.getTime()) || input.observedAt.getTime() > Date.now() + 60_000) {
      throw new SupervisorObservationInputError("Observation time cannot be in the future.");
    }

    const db = await this.databasePromise;
    return db.transaction(async (tx) => {
      await liveCompany(tx, principal);
      if (input.observerMembershipId !== scope.membershipId) throw new SupervisorObservationInputError("You must sign your own observation.");
      const caseResult = await tx.query<{ worker_account_id: string }>(
        "SELECT cases.worker_account_id FROM assurance_cases cases JOIN assurance_orders orders ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id WHERE cases.tenant_id=$1 AND cases.case_id=$2 AND cases.case_status NOT IN ('Closed','Rejected','Issued') AND cases.closed_at IS NULL AND orders.assessment_framework_references ? $3 FOR UPDATE OF cases,orders",
        [scope.tenantId, input.caseId, framework]
      );
      const assuranceCase = caseResult.rows[0];
      if (!assuranceCase) throw new SupervisorObservationInputError("Assurance Case is unavailable.");

      const supervisorResult = await tx.query<{ membership_id: string }>(
        `SELECT membership_id
           FROM auth_tenant_memberships
          WHERE tenant_id=$1 AND membership_id=$2
            AND portal_role='company' AND membership_status='active'`,
        [scope.tenantId, input.observerMembershipId]
      );
      if (!supervisorResult.rows[0]) {
        throw new SupervisorObservationInputError("Selected supervisor is not an active company member.");
      }

      const observationId = createIdentifier("supervisor_observation");
      const now = new Date().toISOString();
      await tx.query(
        `INSERT INTO supervisor_observations(
           observation_id,tenant_id,case_id,worker_account_id,competency_reference,
           observer_membership_id,observed_at,observation_text,outcome,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          observationId, scope.tenantId, input.caseId, assuranceCase.worker_account_id,
          competency, input.observerMembershipId, input.observedAt.toISOString(),
          observation, input.outcome, now
        ]
      );
      await tx.query(
        `INSERT INTO supervisor_observation_details(
           observation_id,framework_reference,task_reference,checklist_json,restrictions,
           supervisor_declaration,supervisor_signed_at,created_at,updated_at
         ) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$7,$7)`,
        [observationId, framework, task, JSON.stringify(checklist), restrictions, declaration, now]
      );
      return observationId;
    });
  }

  async listForWorker(principal: AuthorizationPrincipal): Promise<readonly WorkerObservationView[]> {
    const db = await this.databasePromise;
    return db.transaction(async db => {
      await liveWorker(db, principal);
      return this.readObservations(db, principal.accountId, null);
    });
  }

  async listForCompany(principal: SupervisorObservationCreatePrincipal): Promise<readonly WorkerObservationView[]> {
    const db = await this.databasePromise;
    const scope = deriveTrustedTenantScope(principal);
    return db.transaction(async db => {
      await liveCompany(db, principal);
      return this.readObservations(db, principal.accountId, scope.tenantId);
    });
  }

  private async readObservations(db: DatabaseClient, accountId: string, tenantId: string | null): Promise<readonly WorkerObservationView[]> {
    const result = await db.query<{
      observation_id: string; competency_reference: string; framework_reference: string;
      task_reference: string; observed_at: string | Date; observation_text: string;
      outcome: string; restrictions: string | null; display_name: string;
      supervisor_signed_at: string | Date | null; worker_acknowledged_at: string | Date | null;
      worker_comment: string | null; checklist_json: string[] | string | null; supervisor_declaration: string | null; review_status: string | null; review_reason: string | null;
    }>(
      `SELECT observations.observation_id,observations.competency_reference,
              details.framework_reference,details.task_reference,observations.observed_at,
              observations.observation_text,observations.outcome,details.restrictions,
              accounts.display_name,details.supervisor_signed_at,
              details.worker_acknowledged_at,details.worker_comment,details.checklist_json,details.supervisor_declaration,review.task_status AS review_status,decision.reason AS review_reason
         FROM supervisor_observations AS observations
         LEFT JOIN supervisor_observation_details AS details ON details.observation_id=observations.observation_id
         JOIN auth_tenant_memberships AS memberships ON memberships.membership_id=observations.observer_membership_id
         JOIN auth_accounts AS accounts ON accounts.account_id=memberships.account_id
         LEFT JOIN evidence_review_tasks review ON review.evidence_kind='supervisor_observation'
          AND review.source_record_id=observations.observation_id AND review.source_version_id=observations.observation_id
          AND review.case_id=observations.case_id AND review.worker_account_id=observations.worker_account_id
         LEFT JOIN evidence_review_decisions decision ON decision.task_id=review.task_id
        WHERE (( $2::text IS NULL AND observations.worker_account_id=$1) OR observations.tenant_id=$2)
          AND observations.observation_status='submitted'
        ORDER BY observations.observed_at DESC,observations.observation_id DESC`,
      [accountId, tenantId]
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      observationId: row.observation_id,
      competencyReference: row.competency_reference,
      frameworkReference: row.framework_reference ?? "Legacy framework unavailable",
      taskReference: row.task_reference ?? "Legacy unsigned observation",
      observedAt: new Date(row.observed_at).toISOString(),
      observationText: row.observation_text,
      outcome: row.outcome,
      restrictions: row.restrictions,
      supervisorName: row.display_name,
      supervisorSignedAt: row.supervisor_signed_at ? new Date(row.supervisor_signed_at).toISOString() : null,
      workerAcknowledgedAt: row.worker_acknowledged_at ? new Date(row.worker_acknowledged_at).toISOString() : null,
      workerComment: row.worker_comment,
      checklist: Object.freeze(Array.isArray(row.checklist_json) ? row.checklist_json : JSON.parse(row.checklist_json ?? "[]") as string[]),
      supervisorDeclaration: row.supervisor_declaration,
      reviewStatus: row.review_status,
      reviewReason: row.review_reason
    })));
  }

  async findAssignedSupervisor(principal: AuthorizationPrincipal, taskId: string): Promise<WorkerObservationView | null> {
    if (principal.activeRole !== "verifier" || principal.accountStatus !== "active" || principal.tenantMembership !== null) throw new SupervisorObservationInputError("Verifier access is required.");
    const db = await this.databasePromise;
    return db.transaction(async db => {
      const live = await db.query(`SELECT 1 FROM auth_sessions sessions
        JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id
        JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='verifier'
        WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role='verifier'
          AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp() AND accounts.account_status='active'
        FOR UPDATE OF sessions,accounts,roles`,[principal.sessionId,principal.accountId]);
      if (!live.rows[0]) throw new SupervisorObservationInputError("Verifier access is unavailable.");
      const assigned = await db.query<{worker_account_id:string;source_version_id:string}>(`SELECT tasks.worker_account_id,tasks.source_version_id FROM evidence_review_tasks tasks
        JOIN supervisor_observations observations ON observations.observation_id=tasks.source_version_id
          AND observations.case_id=tasks.case_id AND observations.worker_account_id=tasks.worker_account_id AND observations.observation_status='submitted'
        JOIN supervisor_observation_details details ON details.observation_id=observations.observation_id AND details.worker_acknowledged_at IS NOT NULL
        WHERE tasks.task_id=$1 AND tasks.assigned_verifier_account_id=$2 AND tasks.task_status='ASSIGNED'
          AND tasks.evidence_kind='supervisor_observation' AND tasks.worker_account_id<>$2
          AND NOT EXISTS(SELECT 1 FROM evidence_review_conflicts conflicts WHERE conflicts.task_id=tasks.task_id AND conflicts.verifier_account_id=$2)
        FOR UPDATE OF tasks`,[taskId,principal.accountId]);
      if (!assigned.rows[0]) return null;
      const rows = await this.readObservations(db, assigned.rows[0].worker_account_id, null);
      return rows.find(row => row.observationId===assigned.rows[0].source_version_id) ?? null;
    });
  }

  async acknowledge(
    principal: AuthorizationPrincipal,
    observationId: string,
    commentValue: string
  ): Promise<void> {
    if (principal.activeRole !== "worker" || principal.accountStatus !== "active") {
      throw new SupervisorObservationInputError("Worker access is required.");
    }
    const comment = commentValue.trim() || null;
    if (comment && comment.length > 2000) throw new SupervisorObservationInputError("Comment exceeds 2000 characters.");
    const db = await this.databasePromise;
    await db.transaction(async (tx) => {
      await liveWorker(tx, principal);
      const row = await tx.query<{
        tenant_id: string; case_id: string; worker_account_id: string; competency_reference: string;
      }>(
        `SELECT tenant_id,case_id,worker_account_id,competency_reference
           FROM supervisor_observations
          WHERE observation_id=$1 AND worker_account_id=$2 AND observation_status='submitted'
          FOR UPDATE`,
        [observationId, principal.accountId]
      );
      const observation = row.rows[0];
      if (!observation) throw new SupervisorObservationInputError("Observation is unavailable.");
      const activeCase = await tx.query("SELECT 1 FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2 AND closed_at IS NULL AND case_status NOT IN ('Closed','Rejected','Issued') FOR UPDATE", [observation.case_id, observation.tenant_id]);
      if (!activeCase.rows[0]) throw new SupervisorObservationInputError("Assurance Case is no longer active.");
      const now = new Date().toISOString();
      const updated = await tx.query(
        `UPDATE supervisor_observation_details
            SET worker_acknowledged_at=$2,worker_comment=$3,updated_at=$2
          WHERE observation_id=$1 AND worker_acknowledged_at IS NULL`,
        [observationId, now, comment]
      );
      if (updated.affectedRows !== 1) {
        throw new SupervisorObservationInputError("Observation was already acknowledged.");
      }
      await tx.query(
        `INSERT INTO evidence_review_tasks(
           task_id,tenant_id,case_id,worker_account_id,evidence_kind,
           source_record_id,source_version_id,secure_file_id,evidence_label,
           task_status,created_at,updated_at
         ) VALUES($1,$2,$3,$4,'supervisor_observation',$5,$5,NULL,$6,'QUEUED',$7,$7)
         ON CONFLICT(case_id,evidence_kind,source_version_id) DO NOTHING`,
        [
          createIdentifier("evidence_review"),
          observation.tenant_id,
          observation.case_id,
          observation.worker_account_id,
          observationId,
          `Supervisor observation: ${observation.competency_reference}`,
          now
        ]
      );
      await new EvidenceReviewService(tx).routePendingCaseReview(principal, observation.case_id,
        observation.tenant_id, observation.worker_account_id, observationId, new Date(now));
    });
  }
}

let service: SupervisorObservationService | null = null;
export function getSupervisorObservationService(): SupervisorObservationService {
  service ??= new SupervisorObservationService();
  return service;
}
