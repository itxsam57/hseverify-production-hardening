import "server-only";

import { createIdentifier } from "../auth/auth-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { runTenantScopedCommand } from "../authorization/tenant-scoped-command-guard";
import type { TenantPermissionPrincipal } from "../authorization/tenant-scoped-resource-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import { hasUnseenAssessmentCapacity } from "../assessment-generation/assessment-form-generation-service";
import { fundingId } from "../billing/funding-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import { createPolicySnapshotId } from "../policy/effective-policy-domain";
import { resolveEffectivePolicy } from "../policy/effective-policy-service";

const INDEPENDENT_SCOPE_ID = "tenant_independent_worker_scope";

export type WorkerAssessmentFundingMode = "WORKER_PAY" | "COMPANY_REQUEST";
export type WorkerAssessmentApplicationStatus =
  | "PAYMENT_REQUIRED"
  | "FUNDING_REQUESTED"
  | "FUNDED"
  | "CASE_CREATED"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";

export type WorkerAssessmentOffering = Readonly<{
  catalogueEntryId: string;
  catalogueVersionId: string;
  catalogueReference: string;
  title: string;
  description: string | null;
  frameworkId: string;
  frameworkReference: string;
  blueprintVersionId: string;
  policyReference: string;
  minimumVerifiedQualifications: number;
  verifiedQualificationCount: number;
}>;

export type WorkerFundingCompany = Readonly<{
  tenantId: string;
  workerLinkId: string;
  companyName: string;
}>;

export type WorkerAssessmentApplication = Readonly<{
  applicationId: string;
  workerAccountId: string;
  permanentWorkerId: string;
  catalogueVersionId: string;
  title: string;
  fundingMode: WorkerAssessmentFundingMode;
  companyTenantId: string | null;
  companyName: string | null;
  fundingRequestId: string | null;
  sandboxPaymentReference: string | null;
  status: WorkerAssessmentApplicationStatus;
  assuranceOrderId: string | null;
  assuranceCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type OfferingRow = {
  catalogue_entry_id: string;
  catalogue_version_id: string;
  catalogue_reference: string;
  title: string;
  description: string | null;
  framework_id: string;
  framework_reference: string;
  blueprint_version_id: string;
  policy_reference: string;
  minimum_verified_qualifications: number | string;
  verified_qualification_count: number | string;
};

type ApplicationRow = {
  application_id: string;
  worker_account_id: string;
  permanent_worker_id: string;
  catalogue_version_id: string;
  title: string;
  funding_mode: WorkerAssessmentFundingMode;
  company_tenant_id: string | null;
  company_name: string | null;
  funding_request_id: string | null;
  sandbox_payment_reference: string | null;
  application_status: WorkerAssessmentApplicationStatus;
  assurance_order_id: string | null;
  assurance_case_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export class WorkerAssessmentApplicationAccessError extends Error {
  constructor(message = "Assessment application is unavailable.") {
    super(message);
    this.name = "WorkerAssessmentApplicationAccessError";
  }
}
export class WorkerAssessmentApplicationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerAssessmentApplicationConflictError";
  }
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function offering(row: OfferingRow): WorkerAssessmentOffering {
  return Object.freeze({
    catalogueEntryId: row.catalogue_entry_id,
    catalogueVersionId: row.catalogue_version_id,
    catalogueReference: row.catalogue_reference,
    title: row.title,
    description: row.description,
    frameworkId: row.framework_id,
    frameworkReference: row.framework_reference,
    blueprintVersionId: row.blueprint_version_id,
    policyReference: row.policy_reference,
    minimumVerifiedQualifications: Number(row.minimum_verified_qualifications),
    verifiedQualificationCount: Number(row.verified_qualification_count)
  });
}

function application(row: ApplicationRow): WorkerAssessmentApplication {
  return Object.freeze({
    applicationId: row.application_id,
    workerAccountId: row.worker_account_id,
    permanentWorkerId: row.permanent_worker_id,
    catalogueVersionId: row.catalogue_version_id,
    title: row.title,
    fundingMode: row.funding_mode,
    companyTenantId: row.company_tenant_id,
    companyName: row.company_name,
    fundingRequestId: row.funding_request_id,
    sandboxPaymentReference: row.sandbox_payment_reference,
    status: row.application_status,
    assuranceOrderId: row.assurance_order_id,
    assuranceCaseId: row.assurance_case_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

async function assertLiveWorker(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  permission: "worker.assessments.read" | "worker.self.manage",
  now: Date
): Promise<void> {
  if (
    principal.activeRole !== "worker" ||
    principal.accountStatus !== "active" ||
    !evaluatePlatformPermission({ role: principal.activeRole, permission }).allowed
  ) {
    throw new WorkerAssessmentApplicationAccessError();
  }
  const current = await database.query(
    `SELECT 1
       FROM auth_sessions AS sessions
       JOIN auth_accounts AS accounts ON accounts.account_id=sessions.account_id
      WHERE sessions.session_id=$1
        AND sessions.account_id=$2
        AND sessions.active_role='worker'
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at>$3
        AND accounts.account_status='active'
      LIMIT 1`,
    [principal.sessionId, principal.accountId, now.toISOString()]
  );
  if (!current.rows[0]) throw new WorkerAssessmentApplicationAccessError();
}

async function permanentWorkerId(database: DatabaseClient, workerAccountId: string): Promise<string> {
  const result = await database.query<{ permanent_worker_id: string }>(
    `SELECT ids.permanent_worker_id
       FROM worker_identity_worker_ids AS ids
       JOIN worker_identities AS identities
         ON identities.identity_id=ids.identity_id
        AND identities.worker_account_id=ids.worker_account_id
      WHERE ids.worker_account_id=$1
        AND identities.lifecycle_status IN ('verified','reinstated')
      LIMIT 1`,
    [workerAccountId]
  );
  const workerId = result.rows[0]?.permanent_worker_id;
  if (!workerId) {
    throw new WorkerAssessmentApplicationConflictError(
      "A verified identity and permanent Worker ID are required before applying."
    );
  }
  return workerId;
}

const OFFERING_SQL = `WITH verified_qualification_count AS (
  SELECT COUNT(DISTINCT records.record_id)::int AS qualification_count
    FROM worker_evidence_records AS records
    JOIN worker_evidence_versions AS versions
      ON versions.version_id=records.current_version_id
     AND versions.record_id=records.record_id
     AND versions.version_status='submitted'
    JOIN evidence_review_tasks AS tasks
      ON tasks.source_record_id=records.record_id
     AND tasks.source_version_id=records.current_version_id
     AND tasks.worker_account_id=records.worker_account_id
     AND tasks.evidence_kind='qualification'
     AND tasks.task_status='APPROVED'
    JOIN evidence_review_decisions AS decisions
      ON decisions.task_id=tasks.task_id
     AND decisions.source_version_id=tasks.source_version_id
     AND decisions.outcome='APPROVED'
   WHERE records.worker_account_id=$1
     AND records.record_kind='qualification'
), active_policy AS (
  SELECT packs.framework_id,
         MIN(packs.policy_reference) AS policy_reference,
         COUNT(*)::int AS active_count
    FROM assurance_policy_packs AS packs
    JOIN assurance_policy_versions AS versions
      ON versions.policy_id=packs.policy_id
     AND versions.version_status='PUBLISHED'
     AND versions.effective_from<=$2
     AND (versions.effective_to IS NULL OR versions.effective_to>$2)
   WHERE packs.policy_status='ACTIVE'
   GROUP BY packs.framework_id
   HAVING COUNT(*)=1
)
SELECT entries.catalogue_entry_id,versions.catalogue_version_id,entries.catalogue_reference,
       versions.title,versions.description,versions.framework_id,frameworks.framework_reference,
       versions.blueprint_version_id,active_policy.policy_reference,
       versions.minimum_verified_qualifications,
       COALESCE(verified_qualification_count.qualification_count,0)::int AS verified_qualification_count
  FROM assessment_catalogue_entries AS entries
  JOIN assessment_catalogue_versions AS versions
    ON versions.catalogue_entry_id=entries.catalogue_entry_id
   AND versions.catalogue_version_id=entries.current_version_id
  JOIN assessment_blueprint_versions AS blueprint_versions
    ON blueprint_versions.blueprint_version_id=versions.blueprint_version_id
   AND blueprint_versions.framework_id=versions.framework_id
  JOIN assessment_blueprints AS blueprints
    ON blueprints.blueprint_id=blueprint_versions.blueprint_id
   AND blueprints.blueprint_status='ACTIVE'
  JOIN assurance_frameworks AS frameworks
    ON frameworks.framework_id=versions.framework_id
   AND frameworks.framework_status='ACTIVE'
  JOIN active_policy ON active_policy.framework_id=versions.framework_id
  LEFT JOIN verified_qualification_count ON TRUE
 WHERE entries.catalogue_status='ACTIVE'
   AND COALESCE(verified_qualification_count.qualification_count,0)>=versions.minimum_verified_qualifications
 ORDER BY entries.catalogue_reference,entries.catalogue_entry_id`;

async function eligibleOfferings(
  database: DatabaseClient,
  workerAccountId: string,
  now: Date
): Promise<WorkerAssessmentOffering[]> {
  const rows = await database.query<OfferingRow>(OFFERING_SQL, [
    workerAccountId,
    now.toISOString()
  ]);
  const filtered = await Promise.all(
    rows.rows.map(async (row) => {
      const unseen = await hasUnseenAssessmentCapacity(database, {
        workerAccountId,
        blueprintVersionId: row.blueprint_version_id,
        frameworkId: row.framework_id
      });
      return unseen ? offering(row) : null;
    })
  );
  return filtered.filter((item): item is WorkerAssessmentOffering => item !== null);
}

async function findEligibleOffering(
  database: DatabaseClient,
  workerAccountId: string,
  catalogueVersionId: string,
  now: Date
): Promise<WorkerAssessmentOffering> {
  const available = await eligibleOfferings(database, workerAccountId, now);
  const found = available.find((item) => item.catalogueVersionId === catalogueVersionId);
  if (!found) {
    throw new WorkerAssessmentApplicationConflictError(
      "This assessment is no longer eligible or has insufficient unseen question capacity."
    );
  }
  return found;
}

async function appendEvent(
  database: DatabaseClient,
  input: {
    applicationId: string;
    fromStatus: WorkerAssessmentApplicationStatus | null;
    toStatus: WorkerAssessmentApplicationStatus;
    actorAccountId: string;
    actorRole: "worker" | "company" | "admin" | "root";
    detail?: Record<string, unknown>;
    occurredAt: string;
  }
): Promise<void> {
  await database.query(
    `INSERT INTO worker_assessment_application_events(
       event_id,application_id,from_status,to_status,actor_account_id,actor_role,detail_json,occurred_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      createIdentifier("assessment_application_event"),
      input.applicationId,
      input.fromStatus,
      input.toStatus,
      input.actorAccountId,
      input.actorRole,
      JSON.stringify(input.detail ?? {}),
      input.occurredAt
    ]
  );
}

async function createFundedCase(
  database: DatabaseClient,
  input: {
    applicationId: string;
    workerAccountId: string;
    permanentWorkerId: string;
    offering: WorkerAssessmentOffering;
    tenantId: string;
    workerLinkId: string;
    fundingMethod: "worker" | "company";
    createdByMembershipId: string;
    actorAccountId: string;
    actorRole: "worker" | "company";
    now: Date;
  }
): Promise<{ orderId: string; caseId: string }> {
  const nowIso = input.now.toISOString();
  const orderId = createIdentifier("assurance_order");
  const targetId = createIdentifier("assurance_target");
  const caseId = createIdentifier("assurance_case");

  const resolution = await resolveEffectivePolicy(database, {
    tenantId: input.tenantId,
    frameworkReferences: [input.offering.frameworkReference],
    policyReference: input.offering.policyReference,
    referenceTime: input.now
  });

  await database.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       requested_identity_checks,requested_evidence_checks,assessment_framework_references,
       interview_required,credential_target,effective_policy_reference,order_status,
       validation_errors,scope_version,submitted_at,created_at,updated_at
     ) VALUES(
       $1,$2,$3,$4,$5,'["identity"]'::jsonb,'["qualification"]'::jsonb,$6::jsonb,
       TRUE,$7,$8,'ACTIVE','[]'::jsonb,1,$9,$9,$9
     )`,
    [
      orderId,
      input.tenantId,
      input.createdByMembershipId,
      `Worker assessment · ${input.offering.title}`,
      `WORKER-${input.applicationId.slice(-18)}`,
      JSON.stringify([input.offering.frameworkReference]),
      input.offering.title,
      input.offering.policyReference,
      nowIso
    ]
  );
  await database.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,
       funding_method,target_status,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$8)`,
    [
      targetId,
      orderId,
      input.tenantId,
      input.workerLinkId,
      input.workerAccountId,
      input.permanentWorkerId,
      input.fundingMethod,
      nowIso
    ]
  );
  await database.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,
       case_status,owner_kind,next_action,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,'Assessment pending','worker',
       'View available assessments and complete the required pre-assessment checks.',$8,$8)`,
    [
      caseId,
      orderId,
      targetId,
      input.tenantId,
      input.workerLinkId,
      input.workerAccountId,
      input.permanentWorkerId,
      nowIso
    ]
  );
  await database.query(
    `INSERT INTO assurance_case_policy_snapshots(
       snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,
       tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at,
       created_by_account_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10,$11)`,
    [
      createPolicySnapshotId(),
      caseId,
      input.tenantId,
      resolution.frameworkId,
      resolution.policyId,
      resolution.globalPolicyVersionId,
      resolution.tenantOverrideId,
      resolution.policySource,
      JSON.stringify(resolution.effectiveValue),
      nowIso,
      input.actorAccountId
    ]
  );
  await database.query(
    `INSERT INTO assurance_case_timeline_events(
       timeline_event_id,tenant_id,order_id,case_id,event_type,from_status,to_status,
       owner_kind,next_action,actor_account_id,actor_role,occurred_at
     ) VALUES($1,$2,$3,$4,'worker_assessment_funded',NULL,'Assessment pending',
       'worker','View available assessments and complete the required pre-assessment checks.',
       $5,$6,$7)`,
    [
      createIdentifier("assurance_event"),
      input.tenantId,
      orderId,
      caseId,
      input.actorAccountId,
      input.actorRole,
      nowIso
    ]
  );
  if (input.fundingMethod === "company") {
    await database.query(
      `INSERT INTO assurance_action_items(
         action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,
         owner_kind,allowed_action,deep_link,statutory,action_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,'warning',
         'Worker must complete the funded assessment.','worker','open_case',$6,
         false,'open',$7,$7)`,
      [
        createIdentifier("assurance_action"),
        input.tenantId,
        orderId,
        caseId,
        input.workerAccountId,
        `/company/assurance-orders/${orderId}#${caseId}`,
        nowIso
      ]
    );
  }

  await database.query(
    `UPDATE worker_assessment_applications
        SET application_status='CASE_CREATED',assurance_order_id=$2,assurance_case_id=$3,
            updated_at=$4,completed_at=$4
      WHERE application_id=$1 AND application_status='FUNDED'`,
    [input.applicationId, orderId, caseId, nowIso]
  );
  await appendEvent(database, {
    applicationId: input.applicationId,
    fromStatus: "FUNDED",
    toStatus: "CASE_CREATED",
    actorAccountId: input.actorAccountId,
    actorRole: input.actorRole,
    detail: { orderId, caseId, tenantId: input.tenantId },
    occurredAt: nowIso
  });
  return { orderId, caseId };
}

async function closeCompletedApplications(database: DatabaseClient, workerAccountId: string, now: Date): Promise<void> {
  await database.query("SELECT account_id FROM auth_accounts WHERE account_id=$1 FOR UPDATE", [workerAccountId]);
  const closed = await database.query<{ application_id: string }>(
    `UPDATE worker_assessment_applications applications
        SET application_status='COMPLETED',completed_at=$2,updated_at=$2
       FROM assurance_cases cases
      WHERE applications.worker_account_id=$1 AND applications.application_status='CASE_CREATED'
        AND cases.case_id=applications.assurance_case_id
        AND (cases.case_status IN ('Approved','Conditionally approved','Rejected','Closed','Reassessment required') OR EXISTS (
          SELECT 1 FROM living_record_competencies competencies JOIN living_record_versions versions
            ON versions.competency_id=competencies.competency_id
           WHERE competencies.source_credential_id=cases.credential_reference
             AND versions.version=(SELECT MAX(latest.version) FROM living_record_versions latest WHERE latest.competency_id=competencies.competency_id)
             AND versions.status='reassessment_required'))
      RETURNING applications.application_id`, [workerAccountId, now.toISOString()]);
  for (const row of closed.rows) await appendEvent(database, { applicationId: row.application_id,
    fromStatus: "CASE_CREATED", toStatus: "COMPLETED", actorAccountId: workerAccountId, actorRole: "worker",
    detail: { reason: "Previous case completed or reassessment required; original case history retained." }, occurredAt: now.toISOString() });
}

export class WorkerAssessmentApplicationService {
  constructor(private readonly database: DatabaseClient) {}

  async listOfferings(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<readonly WorkerAssessmentOffering[]> {
    await assertLiveWorker(this.database, principal, "worker.assessments.read", now);
    try {
      await permanentWorkerId(this.database, principal.accountId);
    } catch (error) {
      if (error instanceof WorkerAssessmentApplicationConflictError) return Object.freeze([]);
      throw error;
    }
    return Object.freeze(await eligibleOfferings(this.database, principal.accountId, now));
  }

  async listFundingCompanies(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<readonly WorkerFundingCompany[]> {
    await assertLiveWorker(this.database, principal, "worker.assessments.read", now);
    const result = await this.database.query<{
      tenant_id: string;
      link_id: string;
      display_name: string;
    }>(
      `SELECT links.tenant_id,links.link_id,tenants.display_name
         FROM company_worker_links AS links
         JOIN platform_tenants AS tenants
           ON tenants.tenant_id=links.tenant_id
          AND tenants.tenant_status='active'
        WHERE links.worker_account_id=$1
          AND links.link_status='active'
        ORDER BY lower(tenants.display_name),tenants.tenant_id`,
      [principal.accountId]
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          tenantId: row.tenant_id,
          workerLinkId: row.link_id,
          companyName: row.display_name
        })
      )
    );
  }

  async listApplications(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<readonly WorkerAssessmentApplication[]> {
    await assertLiveWorker(this.database, principal, "worker.assessments.read", now);
    const result = await this.database.query<ApplicationRow>(
      `SELECT applications.*,catalogue.title,tenants.display_name AS company_name
         FROM worker_assessment_applications AS applications
         JOIN assessment_catalogue_versions AS catalogue
           ON catalogue.catalogue_version_id=applications.catalogue_version_id
         LEFT JOIN platform_tenants AS tenants
           ON tenants.tenant_id=applications.company_tenant_id
        WHERE applications.worker_account_id=$1
        ORDER BY applications.created_at DESC,applications.application_id DESC`,
      [principal.accountId]
    );
    return Object.freeze(result.rows.map(application));
  }

  async applyWorkerPay(
    principal: AuthorizationPrincipal,
    catalogueVersionId: string,
    now = new Date()
  ): Promise<WorkerAssessmentApplication> {
    await assertLiveWorker(this.database, principal, "worker.self.manage", now);
    const workerId = await permanentWorkerId(this.database, principal.accountId);
    const selected = await findEligibleOffering(
      this.database,
      principal.accountId,
      catalogueVersionId.trim(),
      now
    );
    return this.database.transaction(async (database) => {
      await closeCompletedApplications(database, principal.accountId, now);
      const id = createIdentifier("assessment_application");
      const paymentReference = `sandbox_worker_payment_${id.slice(-24)}`;
      const nowIso = now.toISOString();
      try {
        await database.query(
          `INSERT INTO worker_assessment_applications(
             application_id,worker_account_id,permanent_worker_id,catalogue_entry_id,
             catalogue_version_id,funding_mode,sandbox_payment_reference,application_status,
             created_at,updated_at
           ) VALUES($1,$2,$3,$4,$5,'WORKER_PAY',$6,'PAYMENT_REQUIRED',$7,$7)`,
          [
            id,
            principal.accountId,
            workerId,
            selected.catalogueEntryId,
            selected.catalogueVersionId,
            paymentReference,
            nowIso
          ]
        );
      } catch (error) {
        if ((error as { code?: string })?.code === "23505") {
          throw new WorkerAssessmentApplicationConflictError(
            "An active application already exists for this assessment."
          );
        }
        throw error;
      }
      await appendEvent(database, {
        applicationId: id,
        fromStatus: null,
        toStatus: "PAYMENT_REQUIRED",
        actorAccountId: principal.accountId,
        actorRole: "worker",
        detail: { providerMode: "sandbox", catalogueVersionId: selected.catalogueVersionId },
        occurredAt: nowIso
      });
      return application({
        application_id: id,
        worker_account_id: principal.accountId,
        permanent_worker_id: workerId,
        catalogue_version_id: selected.catalogueVersionId,
        title: selected.title,
        funding_mode: "WORKER_PAY",
        company_tenant_id: null,
        company_name: null,
        funding_request_id: null,
        sandbox_payment_reference: paymentReference,
        application_status: "PAYMENT_REQUIRED",
        assurance_order_id: null,
        assurance_case_id: null,
        created_at: nowIso,
        updated_at: nowIso
      });
    });
  }

  async confirmSandboxWorkerPayment(
    principal: AuthorizationPrincipal,
    applicationId: string,
    now = new Date()
  ): Promise<{ orderId: string; caseId: string }> {
    await assertLiveWorker(this.database, principal, "worker.self.manage", now);
    return this.database.transaction(async (database) => {
      const found = await database.query<ApplicationRow & {
        catalogue_entry_id: string;
        catalogue_reference: string;
        description: string | null;
        framework_id: string;
        framework_reference: string;
        blueprint_version_id: string;
        policy_reference: string;
        minimum_verified_qualifications: number | string;
        verified_qualification_count: number | string;
      }>(
        `SELECT applications.*,catalogue.title,catalogue.catalogue_entry_id,
                entries.catalogue_reference,catalogue.description,catalogue.framework_id,
                frameworks.framework_reference,catalogue.blueprint_version_id,
                policies.policy_reference,catalogue.minimum_verified_qualifications,
                0::int AS verified_qualification_count,NULL::text AS company_name
           FROM worker_assessment_applications AS applications
           JOIN assessment_catalogue_versions AS catalogue
             ON catalogue.catalogue_version_id=applications.catalogue_version_id
           JOIN assessment_catalogue_entries AS entries
             ON entries.catalogue_entry_id=catalogue.catalogue_entry_id
           JOIN assurance_frameworks AS frameworks
             ON frameworks.framework_id=catalogue.framework_id
           JOIN assurance_policy_packs AS policies
             ON policies.framework_id=catalogue.framework_id
            AND policies.policy_status='ACTIVE'
          WHERE applications.application_id=$1
            AND applications.worker_account_id=$2
            AND applications.funding_mode='WORKER_PAY'
          ORDER BY policies.policy_reference
          LIMIT 1
          FOR UPDATE OF applications`,
        [applicationId.trim(), principal.accountId]
      );
      const row = found.rows[0];
      if (!row || row.application_status !== "PAYMENT_REQUIRED") {
        throw new WorkerAssessmentApplicationConflictError(
          "This sandbox payment is no longer available."
        );
      }
      const selected = await findEligibleOffering(
        database,
        principal.accountId,
        row.catalogue_version_id,
        now
      );
      const nowIso = now.toISOString();
      await database.query(
        `UPDATE worker_assessment_applications
            SET application_status='FUNDED',funded_at=$3,updated_at=$3
          WHERE application_id=$1 AND worker_account_id=$2 AND application_status='PAYMENT_REQUIRED'`,
        [row.application_id, principal.accountId, nowIso]
      );
      await appendEvent(database, {
        applicationId: row.application_id,
        fromStatus: "PAYMENT_REQUIRED",
        toStatus: "FUNDED",
        actorAccountId: principal.accountId,
        actorRole: "worker",
        detail: {
          providerMode: "sandbox",
          paymentReference: row.sandbox_payment_reference
        },
        occurredAt: nowIso
      });
      return createFundedCase(database, {
        applicationId: row.application_id,
        workerAccountId: principal.accountId,
        permanentWorkerId: row.permanent_worker_id,
        offering: selected,
        tenantId: INDEPENDENT_SCOPE_ID,
        workerLinkId: `worker_self_link_${row.application_id.slice(-24)}`,
        fundingMethod: "worker",
        createdByMembershipId: "worker-self-service",
        actorAccountId: principal.accountId,
        actorRole: "worker",
        now
      });
    });
  }

  async requestCompanyFunding(
    principal: AuthorizationPrincipal,
    input: { catalogueVersionId: string; tenantId: string; workerLinkId: string },
    now = new Date()
  ): Promise<WorkerAssessmentApplication> {
    await assertLiveWorker(this.database, principal, "worker.self.manage", now);
    const workerId = await permanentWorkerId(this.database, principal.accountId);
    const selected = await findEligibleOffering(
      this.database,
      principal.accountId,
      input.catalogueVersionId.trim(),
      now
    );

    return this.database.transaction(async (database) => {
      await closeCompletedApplications(database, principal.accountId, now);
      const link = await database.query<{ tenant_id: string; link_id: string; display_name: string }>(
        `SELECT links.tenant_id,links.link_id,tenants.display_name
           FROM company_worker_links AS links
           JOIN platform_tenants AS tenants
             ON tenants.tenant_id=links.tenant_id
            AND tenants.tenant_status='active'
          WHERE links.worker_account_id=$1
            AND links.tenant_id=$2
            AND links.link_id=$3
            AND links.link_status='active'
          FOR UPDATE OF links`,
        [principal.accountId, input.tenantId.trim(), input.workerLinkId.trim()]
      );
      const company = link.rows[0];
      if (!company) {
        throw new WorkerAssessmentApplicationAccessError(
          "The selected Company funding relationship is unavailable."
        );
      }

      const id = createIdentifier("assessment_application");
      const requestId = fundingId();
      const nowIso = now.toISOString();
      await database.query(
        `INSERT INTO funding_requests(
           funding_request_id,tenant_id,worker_link_id,requested_by_account_id,status,
           credit_units,idempotency_key,created_at,updated_at
         ) VALUES($1,$2,$3,$4,'REQUESTED',1,$5,$6,$6)`,
        [
          requestId,
          company.tenant_id,
          company.link_id,
          principal.accountId,
          `worker-application-${id}`,
          nowIso
        ]
      );
      try {
        await database.query(
          `INSERT INTO worker_assessment_applications(
             application_id,worker_account_id,permanent_worker_id,catalogue_entry_id,
             catalogue_version_id,funding_mode,company_tenant_id,worker_link_id,
             funding_request_id,application_status,created_at,updated_at
           ) VALUES($1,$2,$3,$4,$5,'COMPANY_REQUEST',$6,$7,$8,'FUNDING_REQUESTED',$9,$9)`,
          [
            id,
            principal.accountId,
            workerId,
            selected.catalogueEntryId,
            selected.catalogueVersionId,
            company.tenant_id,
            company.link_id,
            requestId,
            nowIso
          ]
        );
      } catch (error) {
        if ((error as { code?: string })?.code === "23505") {
          throw new WorkerAssessmentApplicationConflictError(
            "An active application already exists for this assessment."
          );
        }
        throw error;
      }
      await appendEvent(database, {
        applicationId: id,
        fromStatus: null,
        toStatus: "FUNDING_REQUESTED",
        actorAccountId: principal.accountId,
        actorRole: "worker",
        detail: { tenantId: company.tenant_id, fundingRequestId: requestId },
        occurredAt: nowIso
      });
      return application({
        application_id: id,
        worker_account_id: principal.accountId,
        permanent_worker_id: workerId,
        catalogue_version_id: selected.catalogueVersionId,
        title: selected.title,
        funding_mode: "COMPANY_REQUEST",
        company_tenant_id: company.tenant_id,
        company_name: company.display_name,
        funding_request_id: requestId,
        sandbox_payment_reference: null,
        application_status: "FUNDING_REQUESTED",
        assurance_order_id: null,
        assurance_case_id: null,
        created_at: nowIso,
        updated_at: nowIso
      });
    });
  }

  async listCompanyFundingRequests(
    tenantId: string
  ): Promise<readonly {
    fundingRequestId: string;
    applicationId: string;
    workerAccountId: string;
    catalogueTitle: string;
    status: string;
    creditUnits: number;
    createdAt: string;
  }[]> {
    const result = await this.database.query<{
      funding_request_id: string;
      application_id: string;
      worker_account_id: string;
      title: string;
      status: string;
      credit_units: number | string;
      created_at: string | Date;
    }>(
      `SELECT funding.funding_request_id,applications.application_id,
              applications.worker_account_id,catalogue.title,funding.status,
              funding.credit_units,funding.created_at
         FROM funding_requests AS funding
         JOIN worker_assessment_applications AS applications
           ON applications.funding_request_id=funding.funding_request_id
          AND applications.company_tenant_id=funding.tenant_id
         JOIN assessment_catalogue_versions AS catalogue
           ON catalogue.catalogue_version_id=applications.catalogue_version_id
        WHERE funding.tenant_id=$1
        ORDER BY funding.created_at DESC,funding.funding_request_id DESC`,
      [tenantId]
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          fundingRequestId: row.funding_request_id,
          applicationId: row.application_id,
          workerAccountId: row.worker_account_id,
          catalogueTitle: row.title,
          status: row.status,
          creditUnits: Number(row.credit_units),
          createdAt: iso(row.created_at)
        })
      )
    );
  }

  async decideCompanyFunding(principal: TenantPermissionPrincipal<"company.billing.manage">, input: {
    fundingRequestId: string;
    approved: boolean;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await runTenantScopedCommand({database: this.database, principal, permission: "company.billing.manage", now, operation: async ({database, scope}) => {
      const found = await database.query<{
        funding_request_id: string;
        status: string;
        credit_units: number | string;
        application_id: string;
        worker_account_id: string;
        permanent_worker_id: string;
        worker_link_id: string;
        catalogue_version_id: string;
      }>(
        `SELECT funding.funding_request_id,funding.status,funding.credit_units,
                applications.application_id,applications.worker_account_id,
                applications.permanent_worker_id,applications.worker_link_id,
                applications.catalogue_version_id
           FROM funding_requests AS funding
           JOIN worker_assessment_applications AS applications
             ON applications.funding_request_id=funding.funding_request_id
            AND applications.company_tenant_id=funding.tenant_id
          WHERE funding.tenant_id=$1 AND funding.funding_request_id=$2
          FOR UPDATE OF funding,applications`,
        [scope.tenantId, input.fundingRequestId.trim()]
      );
      const row = found.rows[0];
      if (!row || row.status !== "REQUESTED") {
        throw new WorkerAssessmentApplicationConflictError(
          "This Company funding request is no longer pending."
        );
      }

      const nowIso = now.toISOString();
      if (!input.approved) {
        await database.query(
          `UPDATE funding_requests
              SET status='REJECTED',reserved_credit_units=0,updated_at=$3
            WHERE tenant_id=$1 AND funding_request_id=$2 AND status='REQUESTED'`,
          [scope.tenantId, row.funding_request_id, nowIso]
        );
        await database.query(
          `UPDATE worker_assessment_applications
              SET application_status='REJECTED',updated_at=$2
            WHERE application_id=$1 AND application_status='FUNDING_REQUESTED'`,
          [row.application_id, nowIso]
        );
        await appendEvent(database, {
          applicationId: row.application_id,
          fromStatus: "FUNDING_REQUESTED",
          toStatus: "REJECTED",
          actorAccountId: scope.accountId,
          actorRole: "company",
          detail: { fundingRequestId: row.funding_request_id },
          occurredAt: nowIso
        });
        return;
      }

      const activeLink = await database.query(
        `SELECT 1 FROM company_worker_links
          WHERE tenant_id=$1 AND link_id=$2 AND worker_account_id=$3 AND link_status='active'
          FOR UPDATE`, [scope.tenantId, row.worker_link_id, row.worker_account_id]
      );
      if (!activeLink.rows.length) throw new WorkerAssessmentApplicationConflictError("The Worker is no longer linked to this Company.");
      await permanentWorkerId(database, row.worker_account_id);

      const ledger = await database.query<{ balance: number | string }>(
        `SELECT COALESCE(SUM(credit_delta),0)::int AS balance
           FROM billing_credit_ledger
          WHERE tenant_id=$1`,
        [scope.tenantId]
      );
      const reserved = await database.query<{ reserved: number | string }>(
        `SELECT COALESCE(SUM(reserved_credit_units),0)::int AS reserved
           FROM funding_requests
          WHERE tenant_id=$1 AND status='APPROVED'`,
        [scope.tenantId]
      );
      const available =
        Number(ledger.rows[0]?.balance ?? 0) - Number(reserved.rows[0]?.reserved ?? 0);
      if (available < Number(row.credit_units)) {
        throw new WorkerAssessmentApplicationConflictError(
          "The Company does not have enough unreserved assessment credits."
        );
      }

      await database.query(
        `UPDATE funding_requests
            SET status='APPROVED',reserved_credit_units=credit_units,updated_at=$3
          WHERE tenant_id=$1 AND funding_request_id=$2 AND status='REQUESTED'`,
        [scope.tenantId, row.funding_request_id, nowIso]
      );
      await database.query(
        `UPDATE worker_assessment_applications
            SET application_status='FUNDED',funded_at=$2,updated_at=$2
          WHERE application_id=$1 AND application_status='FUNDING_REQUESTED'`,
        [row.application_id, nowIso]
      );
      await appendEvent(database, {
        applicationId: row.application_id,
        fromStatus: "FUNDING_REQUESTED",
        toStatus: "FUNDED",
        actorAccountId: scope.accountId,
        actorRole: "company",
        detail: { fundingRequestId: row.funding_request_id, reservedCredits: Number(row.credit_units) },
        occurredAt: nowIso
      });

      const selected = await findEligibleOffering(
        database,
        row.worker_account_id,
        row.catalogue_version_id,
        now
      );
      await createFundedCase(database, {
        applicationId: row.application_id,
        workerAccountId: row.worker_account_id,
        permanentWorkerId: row.permanent_worker_id,
        offering: selected,
        tenantId: scope.tenantId,
        workerLinkId: row.worker_link_id,
        fundingMethod: "company",
        createdByMembershipId: scope.membershipId,
        actorAccountId: scope.accountId,
        actorRole: "company",
        now
      });
    }});
  }
}

export async function getWorkerAssessmentApplicationService(): Promise<WorkerAssessmentApplicationService> {
  return new WorkerAssessmentApplicationService(await getDatabaseClient());
}