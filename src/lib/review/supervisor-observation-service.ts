import "server-only";

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
  supervisorSignedAt: string;
  workerAcknowledgedAt: string | null;
  workerComment: string | null;
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

export class SupervisorObservationService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async listCompanyContext(principal: SupervisorObservationCreatePrincipal): Promise<{
    supervisors: readonly SupervisorOption[];
    cases: readonly ObservationCaseOption[];
  }> {
    const scope = deriveTrustedTenantScope(principal);
    const db = await this.databasePromise;
    const [supervisors, cases] = await Promise.all([
      db.query<{ membership_id: string; display_name: string; membership_role: string }>(
        `SELECT memberships.membership_id,accounts.display_name,memberships.membership_role
           FROM auth_tenant_memberships AS memberships
           JOIN auth_accounts AS accounts ON accounts.account_id=memberships.account_id
          WHERE memberships.tenant_id=$1
            AND memberships.portal_role='company'
            AND memberships.membership_status='active'
            AND accounts.account_status='active'
          ORDER BY accounts.display_name,memberships.membership_id`,
        [scope.tenantId]
      ),
      db.query<{ case_id: string; worker_account_id: string; display_name: string; case_status: string }>(
        `SELECT cases.case_id,cases.worker_account_id,accounts.display_name,cases.case_status
           FROM assurance_cases AS cases
           JOIN auth_accounts AS accounts ON accounts.account_id=cases.worker_account_id
          WHERE cases.tenant_id=$1
            AND cases.case_status NOT IN ('Closed','Rejected')
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
    const restrictions = input.restrictions?.trim().slice(0, 2000) || null;
    const checklist = input.checklist
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 40)
      .map((item) => item.slice(0, 240));
    if (!["demonstrated", "partially_demonstrated", "not_demonstrated"].includes(input.outcome)) {
      throw new SupervisorObservationInputError("Observation outcome is invalid.");
    }
    if (input.observedAt.getTime() > Date.now() + 60_000) {
      throw new SupervisorObservationInputError("Observation time cannot be in the future.");
    }

    const db = await this.databasePromise;
    return db.transaction(async (tx) => {
      const caseResult = await tx.query<{ worker_account_id: string }>(
        "SELECT worker_account_id FROM assurance_cases WHERE tenant_id=$1 AND case_id=$2 FOR UPDATE",
        [scope.tenantId, input.caseId]
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
    if (principal.activeRole !== "worker" || principal.accountStatus !== "active") {
      throw new SupervisorObservationInputError("Worker access is required.");
    }
    const db = await this.databasePromise;
    const result = await db.query<{
      observation_id: string; competency_reference: string; framework_reference: string;
      task_reference: string; observed_at: string | Date; observation_text: string;
      outcome: string; restrictions: string | null; display_name: string;
      supervisor_signed_at: string | Date; worker_acknowledged_at: string | Date | null;
      worker_comment: string | null;
    }>(
      `SELECT observations.observation_id,observations.competency_reference,
              details.framework_reference,details.task_reference,observations.observed_at,
              observations.observation_text,observations.outcome,details.restrictions,
              accounts.display_name,details.supervisor_signed_at,
              details.worker_acknowledged_at,details.worker_comment
         FROM supervisor_observations AS observations
         JOIN supervisor_observation_details AS details ON details.observation_id=observations.observation_id
         JOIN auth_tenant_memberships AS memberships ON memberships.membership_id=observations.observer_membership_id
         JOIN auth_accounts AS accounts ON accounts.account_id=memberships.account_id
        WHERE observations.worker_account_id=$1
          AND observations.observation_status='submitted'
        ORDER BY observations.observed_at DESC,observations.observation_id DESC`,
      [principal.accountId]
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      observationId: row.observation_id,
      competencyReference: row.competency_reference,
      frameworkReference: row.framework_reference,
      taskReference: row.task_reference,
      observedAt: new Date(row.observed_at).toISOString(),
      observationText: row.observation_text,
      outcome: row.outcome,
      restrictions: row.restrictions,
      supervisorName: row.display_name,
      supervisorSignedAt: new Date(row.supervisor_signed_at).toISOString(),
      workerAcknowledgedAt: row.worker_acknowledged_at ? new Date(row.worker_acknowledged_at).toISOString() : null,
      workerComment: row.worker_comment
    })));
  }

  async acknowledge(
    principal: AuthorizationPrincipal,
    observationId: string,
    commentValue: string
  ): Promise<void> {
    if (principal.activeRole !== "worker" || principal.accountStatus !== "active") {
      throw new SupervisorObservationInputError("Worker access is required.");
    }
    const comment = commentValue.trim().slice(0, 2000) || null;
    const db = await this.databasePromise;
    await db.transaction(async (tx) => {
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
      await tx.query(
        `UPDATE assurance_cases
            SET case_status='Review pending',owner_kind='reviewer',
                next_action='Reviewer must verify the acknowledged supervisor observation.',
                updated_at=$3
          WHERE case_id=$1 AND tenant_id=$2 AND case_status NOT IN ('Rejected','Closed')`,
        [observation.case_id, observation.tenant_id, now]
      );
    });
  }
}

let service: SupervisorObservationService | null = null;
export function getSupervisorObservationService(): SupervisorObservationService {
  service ??= new SupervisorObservationService();
  return service;
}
