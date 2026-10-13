import "server-only";

import { createHash } from "node:crypto";

import { createIdentifier } from "../auth/auth-domain";
import { evaluatePlatformPermission } from "../authorization/authorization-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  deriveTrustedTenantScope,
  type TenantPermissionPrincipal
} from "../authorization/tenant-scoped-resource-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { getServerEnvironment } from "../config/server-environment";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import { createTrustedWorkerIdentityCorrectionAuthority } from "../identity/worker-identity-correction-domain";
import { DatabaseWorkerIdentityCorrectionRepository } from "../identity/worker-identity-correction-repository";
import { WorkerIdentityEligibilityService } from "../identity/worker-identity-eligibility-service";
import { DatabaseWorkerIdentityEligibilityRepository } from "../identity/worker-identity-eligibility-repository";
import { InterviewSchedulingService } from "../interview/interview-scheduling-service";
import {
  authorizeSecureFileAccessCore,
  readSecureFileAccessCore,
  type SecureFileAccessLookup
} from "../secure-files/secure-file-access-core";
import { createRuntimePrivateObjectStorage } from "../secure-files/private-object-storage";
import { secureFileFromRow, type SecureFileRow } from "../secure-files/secure-file-repository";
import {
  EvidenceReviewAccessError,
  EvidenceReviewConflictError,
  EvidenceReviewInputError,
  assertVerifierPrincipal,
  createReviewConflictId,
  createReviewDecisionId,
  createReviewTaskId,
  createSupervisorObservationId,
  normalizeOutcome,
  normalizeReason,
  type EvidenceReviewKind,
  type EvidenceReviewOutcome,
  type EvidenceReviewTask
} from "./evidence-review-domain";

type TaskRow = {
  task_id: string;
  tenant_id: string | null;
  case_id: string | null;
  worker_account_id: string;
  evidence_kind: EvidenceReviewKind;
  source_record_id: string;
  source_version_id: string;
  secure_file_id: string | null;
  evidence_label: string;
  task_status: EvidenceReviewTask["taskStatus"];
  assigned_verifier_account_id: string | null;
  claimed_at: string | Date | null;
  decided_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const TASK_COLUMNS =
  "task_id,tenant_id,case_id,worker_account_id,evidence_kind,source_record_id,source_version_id,secure_file_id,evidence_label,task_status,assigned_verifier_account_id,claimed_at,decided_at,created_at,updated_at";

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function maybe(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function task(row: TaskRow): EvidenceReviewTask {
  return Object.freeze({
    taskId: row.task_id,
    tenantId: row.tenant_id,
    caseId: row.case_id,
    workerAccountId: row.worker_account_id,
    evidenceKind: row.evidence_kind,
    sourceRecordId: row.source_record_id,
    sourceVersionId: row.source_version_id,
    secureFileId: row.secure_file_id,
    evidenceLabel: row.evidence_label,
    taskStatus: row.task_status,
    assignedVerifierAccountId: row.assigned_verifier_account_id,
    claimedAt: maybe(row.claimed_at),
    decidedAt: maybe(row.decided_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertIndependentWorker(principal: AuthorizationPrincipal): void {
  if (
    principal.activeRole !== "worker" ||
    principal.accountStatus !== "active" ||
    principal.tenantMembership !== null
  ) {
    throw new EvidenceReviewAccessError();
  }
}

async function liveVerifier(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<void> {
  assertVerifierPrincipal(principal);
  const result = await database.query(
    `SELECT 1
       FROM auth_sessions AS sessions
       JOIN auth_accounts AS accounts
         ON accounts.account_id=sessions.account_id
       JOIN auth_account_roles AS roles
         ON roles.account_id=accounts.account_id
        AND roles.role='verifier'
      WHERE sessions.session_id=$1
        AND sessions.account_id=$2
        AND sessions.active_role='verifier'
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at>CURRENT_TIMESTAMP
        AND accounts.account_status='active'
      FOR UPDATE OF sessions,accounts`,
    [principal.sessionId, principal.accountId]
  );
  if (!result.rows[0]) throw new EvidenceReviewAccessError();
}

async function auditCaseDecision(
  database: DatabaseClient,
  principal: AuthorizationPrincipal,
  caseId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await new DatabaseAuditRepository(Promise.resolve(database)).append(
    bindTrustedAuditActor(principal),
    {
      action: "assurance_case.status.changed",
      outcome: "succeeded",
      target: { type: "resource", reference: caseId },
      metadata
    }
  );
}

export type EvidenceReviewSkillContext = Readonly<{
  skillName: string | null; category: string | null; proficiencyClaim: string | null;
  experienceMonths: number | null; relatedTrade: string | null; assuranceStatus: string;
  evidenceAvailable: boolean; secureFileId: string | null;
}>;

export class EvidenceReviewService {
  constructor(private readonly database: DatabaseClient) {}

  async listQueue(
    principal: AuthorizationPrincipal,
    query = ""
  ): Promise<readonly EvidenceReviewTask[]> {
    assertVerifierPrincipal(principal);
    const result = await this.database.query<TaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM evidence_review_tasks
        WHERE (task_status='QUEUED' OR assigned_verifier_account_id=$1)
          AND ($2='' OR strpos(lower(concat_ws(' ',task_id,case_id,worker_account_id,
            source_version_id,evidence_kind,task_status,replace(task_status,'_',' '))),lower($2))>0)
        ORDER BY
          CASE task_status WHEN 'ASSIGNED' THEN 0 ELSE 1 END,
          created_at,
          task_id
        LIMIT 250`,
      [principal.accountId, query.trim().slice(0, 160)]
    );
    return Object.freeze(result.rows.map(task));
  }

  async findTask(
    principal: AuthorizationPrincipal,
    taskId: string
  ): Promise<EvidenceReviewTask | null> {
    assertVerifierPrincipal(principal);
    const result = await this.database.query<TaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM evidence_review_tasks
        WHERE task_id=$1
          AND (task_status='QUEUED' OR assigned_verifier_account_id=$2)`,
      [taskId, principal.accountId]
    );
    return result.rows[0] ? task(result.rows[0]) : null;
  }

  private async assignedSkillContext(
    database: DatabaseClient, principal: AuthorizationPrincipal, taskId: string
  ): Promise<EvidenceReviewSkillContext | null> {
    const result = await database.query<{
      skill_name: string | null; category: string | null; proficiency_claim: string | null;
      experience_months: number | null; related_trade: string | null; skill_assurance_status: string;
      evidence_available: boolean; secure_file_id: string | null;
    }>(
      `SELECT skills.skill_name,skills.category,skills.proficiency_claim,skills.experience_months,
        skills.related_trade,skills.skill_assurance_status,tasks.secure_file_id,
        EXISTS(SELECT 1 FROM worker_evidence_attachments attachments
          JOIN platform_secure_files files ON files.file_id=attachments.secure_file_id
           AND files.owner_account_id=records.worker_account_id AND files.owner_role='worker'
           AND files.lifecycle_status='available'
          WHERE attachments.record_id=records.record_id AND attachments.version_id=versions.version_id
           AND attachments.secure_file_id=tasks.secure_file_id AND attachments.superseded_at IS NULL) AS evidence_available
       FROM evidence_review_tasks tasks
       JOIN worker_evidence_records records ON records.record_id=tasks.source_record_id
        AND records.worker_account_id=tasks.worker_account_id AND records.record_kind='skill'
        AND records.lifecycle_status='active' AND records.current_version_id=tasks.source_version_id
       JOIN worker_evidence_versions versions ON versions.version_id=tasks.source_version_id
        AND versions.record_id=records.record_id AND versions.version_status='submitted'
       JOIN worker_skill_versions skills ON skills.version_id=versions.version_id
       WHERE tasks.task_id=$1 AND tasks.assigned_verifier_account_id=$2 AND tasks.evidence_kind='skill'
        AND tasks.task_status='ASSIGNED' AND tasks.worker_account_id<>$2`,
      [taskId, principal.accountId]
    );
    const row=result.rows[0];
    return row ? Object.freeze({skillName:row.skill_name,category:row.category,proficiencyClaim:row.proficiency_claim,
      experienceMonths:row.experience_months,relatedTrade:row.related_trade,assuranceStatus:row.skill_assurance_status,
      evidenceAvailable:row.evidence_available,secureFileId:row.secure_file_id}) : null;
  }

  async findAssignedSkill(principal: AuthorizationPrincipal, taskId: string): Promise<EvidenceReviewSkillContext | null> {
    return this.database.transaction(async database => {
      await liveVerifier(database,principal);
      return this.assignedSkillContext(database,principal,taskId);
    });
  }

  async claim(
    principal: AuthorizationPrincipal,
    taskId: string,
    now = new Date()
  ): Promise<EvidenceReviewTask> {
    return this.database.transaction(async (database) => {
      await liveVerifier(database, principal);
      const conflict = await database.query(
        `SELECT 1
           FROM evidence_review_conflicts
          WHERE task_id=$1 AND verifier_account_id=$2`,
        [taskId, principal.accountId]
      );
      if (conflict.rows[0]) {
        throw new EvidenceReviewConflictError(
          "A declared conflict prevents this assignment."
        );
      }

      const result = await database.query<TaskRow>(
        `UPDATE evidence_review_tasks
            SET task_status='ASSIGNED',
                assigned_verifier_account_id=$2,
                claimed_at=$3,
                updated_at=$3
          WHERE task_id=$1
            AND task_status='QUEUED'
        RETURNING ${TASK_COLUMNS}`,
        [taskId, principal.accountId, now.toISOString()]
      );
      if (!result.rows[0]) {
        throw new EvidenceReviewConflictError(
          "Task was already claimed or is unavailable."
        );
      }
      return task(result.rows[0]);
    });
  }

  private async draftTask(database: DatabaseClient, principal: AuthorizationPrincipal, taskId: string, writing: boolean): Promise<TaskRow> {
    await liveVerifier(database, principal);
    const result = await database.query<TaskRow>(
      `SELECT ${TASK_COLUMNS} FROM evidence_review_tasks WHERE task_id=$1
       AND assigned_verifier_account_id=$2 AND worker_account_id<>$2 FOR UPDATE`,
      [taskId, principal.accountId]
    );
    const row=result.rows[0];
    if(!row) throw new EvidenceReviewAccessError();
    const conflict=await database.query("SELECT 1 FROM evidence_review_conflicts WHERE task_id=$1 AND verifier_account_id=$2",[taskId,principal.accountId]);
    if(conflict.rows[0]) throw new EvidenceReviewAccessError();
    if(writing && (row.task_status!=="ASSIGNED" || !(await this.sourceIsCurrent(database,row)))) throw new EvidenceReviewConflictError();
    return row;
  }

  async findDraftNotes(principal: AuthorizationPrincipal, taskId: string): Promise<Readonly<{revision:number;notes:string;savedAt:string}>|null> {
    return this.database.transaction(async database=>{
      await this.draftTask(database,principal,taskId,false);
      const result=await database.query<{revision:number;notes:string;saved_at:string|Date}>(
        "SELECT revision,notes,saved_at FROM evidence_review_draft_revisions WHERE task_id=$1 AND verifier_account_id=$2 ORDER BY revision DESC LIMIT 1",[taskId,principal.accountId]);
      const row=result.rows[0];return row?Object.freeze({revision:row.revision,notes:row.notes,savedAt:iso(row.saved_at)}):null;
    });
  }

  async saveDraftNotes(principal: AuthorizationPrincipal, taskId: string, notesValue: unknown, expectedRevision: unknown, now=new Date()): Promise<Readonly<{revision:number;notes:string;savedAt:string}>> {
    if(typeof notesValue!=="string" || notesValue.trim().length<5 || notesValue.trim().length>4000 ||
      typeof expectedRevision!=="number" || !Number.isSafeInteger(expectedRevision) || expectedRevision<0 || expectedRevision>=2147483647) throw new EvidenceReviewInputError();
    const notes=notesValue.trim();
    return this.database.transaction(async database=>{
      await this.draftTask(database,principal,taskId,true);
      const current=await database.query<{revision:number}>("SELECT revision FROM evidence_review_draft_revisions WHERE task_id=$1 AND verifier_account_id=$2 ORDER BY revision DESC LIMIT 1",[taskId,principal.accountId]);
      if((current.rows[0]?.revision??0)!==expectedRevision) throw new EvidenceReviewConflictError("Draft notes changed; reload before saving.");
      const revision=expectedRevision+1;
      await database.query("INSERT INTO evidence_review_draft_revisions(task_id,verifier_account_id,revision,notes,saved_at) VALUES($1,$2,$3,$4,$5)",[taskId,principal.accountId,revision,notes,now.toISOString()]);
      await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{
        action:"verification.draft.saved",outcome:"succeeded",target:{type:"resource",reference:taskId},metadata:{revision}
      });
      return Object.freeze({revision,notes,savedAt:now.toISOString()});
    });
  }

  private async liveEscalationAdmin(database:DatabaseClient,principal:AuthorizationPrincipal):Promise<void>{
    if(principal.activeRole!=="admin" || principal.accountStatus!=="active" || principal.tenantMembership!==null ||
      !evaluatePlatformPermission({role:principal.activeRole,permission:"platform.operations.manage"}).allowed) throw new EvidenceReviewAccessError();
    const result=await database.query(`SELECT 1 FROM auth_sessions sessions JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id
      JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='admin'
      WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role='admin' AND sessions.revoked_at IS NULL
      AND sessions.expires_at>CURRENT_TIMESTAMP AND accounts.account_status='active' FOR UPDATE OF sessions,accounts`,[principal.sessionId,principal.accountId]);
    if(!result.rows[0]) throw new EvidenceReviewAccessError();
  }

  async findResolutionHistory(principal:AuthorizationPrincipal,taskId:string):Promise<readonly Readonly<{revision:number;outcome:string;reason:string;attemptedMethods:string|null;limitations:string|null;destination:string|null}>[]>{
    return this.database.transaction(async database=>{
      await this.draftTask(database,principal,taskId,false);
      const result=await database.query<{revision:number;outcome:string;reason:string;attempted_methods:string|null;limitations:string|null;destination:string|null}>("SELECT revision,outcome,reason,attempted_methods,limitations,destination FROM evidence_review_resolution_events WHERE task_id=$1 ORDER BY revision",[taskId]);
      return Object.freeze(result.rows.map(row=>Object.freeze({revision:row.revision,outcome:row.outcome,reason:row.reason,attemptedMethods:row.attempted_methods,limitations:row.limitations,destination:row.destination})));
    });
  }

  private async reviewBlocker(database:DatabaseClient,caseId:string):Promise<TaskRow|null>{
    const result=await database.query<TaskRow>(`SELECT ${TASK_COLUMNS} FROM evidence_review_tasks WHERE case_id=$1 AND task_status NOT IN ('APPROVED','SUPERSEDED','CANCELLED')
      ORDER BY CASE task_status WHEN 'REJECTED' THEN 0 WHEN 'ESCALATED' THEN 1 WHEN 'UNABLE_TO_VERIFY' THEN 2 WHEN 'CHANGES_REQUESTED' THEN 2 ELSE 3 END,created_at,task_id`,[caseId]);
    for(const candidate of result.rows)if(await this.sourceIsCurrent(database,candidate))return candidate;
    return null;
  }

  private reviewBlockerRoute(row:TaskRow):{status:string;owner:string|null;nextAction:string|null}{
    if(row.task_status==="REJECTED")return {status:"Rejected",owner:null,nextAction:null};
    if(row.task_status==="ESCALATED")return {status:"Review pending",owner:"admin",nextAction:"Admin must review the reasoned evidence escalation."};
    if(row.task_status==="UNABLE_TO_VERIFY")return {status:"Evidence pending",owner:"worker",nextAction:"The evidence could not be verified; provide further supporting evidence."};
    if(row.task_status==="CHANGES_REQUESTED")return {status:"Evidence pending",owner:"worker",nextAction:"Correct the reviewed evidence and submit a new version."};
    return {status:"Review pending",owner:"reviewer",nextAction:"Wait for the remaining evidence review tasks."};
  }

  private async recordResolutionCase(database:DatabaseClient,principal:AuthorizationPrincipal,row:TaskRow,now:Date):Promise<void>{
    if(!row.case_id||!row.tenant_id)return;
    const old=await database.query<{case_status:string}>("SELECT case_status FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2 AND worker_account_id=$3 FOR UPDATE",[row.case_id,row.tenant_id,row.worker_account_id]);
    if(!old.rows[0])throw new EvidenceReviewAccessError();
    const blocker=await this.reviewBlocker(database,row.case_id);
    const route=blocker?this.reviewBlockerRoute(blocker):{status:"Review pending",owner:"reviewer",nextAction:"Review the returned evidence escalation."};
    await database.query("UPDATE assurance_cases SET case_status=$3,owner_kind=$4,next_action=$5,updated_at=$6,closed_at=CASE WHEN $3='Rejected' THEN COALESCE(closed_at,$6) ELSE closed_at END WHERE case_id=$1 AND tenant_id=$2",[row.case_id,row.tenant_id,route.status,route.owner,route.nextAction,now.toISOString()]);
    await database.query(`INSERT INTO assurance_case_timeline_events(timeline_event_id,tenant_id,order_id,case_id,event_type,from_status,to_status,owner_kind,next_action,actor_account_id,actor_role,occurred_at)
      SELECT $1,tenant_id,order_id,case_id,'evidence_review_resolution',$2,$3,$4,$5,$6,$7,$8 FROM assurance_cases WHERE case_id=$9`,[createIdentifier("assurance_event"),old.rows[0].case_status,route.status,route.owner,route.nextAction,principal.accountId,principal.activeRole,now.toISOString(),row.case_id]);
  }

  async resolveReview(principal:AuthorizationPrincipal,taskId:string,input:{expectedRevision:unknown;outcome:unknown;reason:unknown;attemptedMethods?:unknown;limitations?:unknown;destination?:unknown},now=new Date()):Promise<void>{
    if(input.outcome!=="UNABLE_TO_VERIFY" && input.outcome!=="ESCALATED") throw new EvidenceReviewInputError();
    if(typeof input.expectedRevision!=="number" || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<0 || input.expectedRevision>=2147483647)throw new EvidenceReviewInputError();
    const outcome=input.outcome,reason=normalizeReason(input.reason);
    const methods=outcome==="UNABLE_TO_VERIFY"?normalizeReason(input.attemptedMethods):null;
    const limitations=outcome==="UNABLE_TO_VERIFY"?normalizeReason(input.limitations):null;
    if(outcome==="ESCALATED" && input.destination!=="admin") throw new EvidenceReviewInputError("Choose the authorized Admin destination.");
    await this.database.transaction(async database=>{
      const row=await this.draftTask(database,principal,taskId,true);
      const last=await database.query<{revision:number}>("SELECT revision FROM evidence_review_resolution_events WHERE task_id=$1 ORDER BY revision DESC LIMIT 1",[taskId]);
      if((last.rows[0]?.revision??0)!==input.expectedRevision)throw new EvidenceReviewConflictError("Review history changed; reload before recording an outcome.");
      const revision=(last.rows[0]?.revision??0)+1;
      await database.query(`INSERT INTO evidence_review_resolution_events(event_id,task_id,source_version_id,revision,actor_account_id,actor_role,outcome,reason,attempted_methods,limitations,destination,occurred_at)
        VALUES($1,$2,$3,$4,$5,'verifier',$6,$7,$8,$9,$10,$11)`,[createIdentifier("review_resolution"),taskId,row.source_version_id,revision,principal.accountId,outcome,reason,methods,limitations,outcome==="ESCALATED"?"admin":null,now.toISOString()]);
      await database.query("UPDATE evidence_review_tasks SET task_status=$2,decided_at=$3,updated_at=$3 WHERE task_id=$1",[taskId,outcome,now.toISOString()]);
      if(outcome==="UNABLE_TO_VERIFY" && row.evidence_kind==="identity")await this.applyIndependentDecision(database,row,"UNABLE_TO_VERIFY",now);
      await this.recordResolutionCase(database,principal,row,now);
      await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"verification.resolution.recorded",outcome:"succeeded",target:{type:"resource",reference:taskId},metadata:{revision,resolution:outcome,destination:outcome==="ESCALATED"?"admin":null}});
    });
  }

  async listEscalations(principal:AuthorizationPrincipal):Promise<readonly Readonly<EvidenceReviewTask&{reason:string;revision:number}>[]>{
    return this.database.transaction(async database=>{
      await this.liveEscalationAdmin(database,principal);
      const result=await database.query<TaskRow&{reason:string;revision:number}>(`SELECT tasks.*,latest.reason,latest.revision FROM evidence_review_tasks tasks
        JOIN LATERAL(SELECT reason,revision FROM evidence_review_resolution_events WHERE task_id=tasks.task_id AND outcome='ESCALATED' ORDER BY revision DESC LIMIT 1)latest ON TRUE
        WHERE tasks.task_status='ESCALATED' ORDER BY tasks.updated_at,tasks.task_id LIMIT 250`);
      return Object.freeze(result.rows.map(row=>Object.freeze({...task(row),reason:row.reason,revision:row.revision})));
    });
  }

  async returnEscalation(principal:AuthorizationPrincipal,taskId:string,expectedRevision:unknown,reasonValue:unknown,now=new Date()):Promise<void>{
    if(typeof expectedRevision!=="number" || !Number.isSafeInteger(expectedRevision) || expectedRevision<1) throw new EvidenceReviewInputError();
    const reason=normalizeReason(reasonValue);
    await this.database.transaction(async database=>{
      await this.liveEscalationAdmin(database,principal);
      const found=await database.query<TaskRow>(`SELECT ${TASK_COLUMNS} FROM evidence_review_tasks WHERE task_id=$1 AND task_status='ESCALATED' FOR UPDATE`,[taskId]);
      const row=found.rows[0];if(!row)throw new EvidenceReviewConflictError();
      const last=await database.query<{revision:number;outcome:string}>("SELECT revision,outcome FROM evidence_review_resolution_events WHERE task_id=$1 ORDER BY revision DESC LIMIT 1",[taskId]);
      if(last.rows[0]?.revision!==expectedRevision || last.rows[0]?.outcome!=="ESCALATED" || !(await this.sourceIsCurrent(database,row)))throw new EvidenceReviewConflictError();
      const revision=expectedRevision+1;
      await database.query(`INSERT INTO evidence_review_resolution_events(event_id,task_id,source_version_id,revision,actor_account_id,actor_role,outcome,reason,occurred_at)
        VALUES($1,$2,$3,$4,$5,'admin','RETURNED_TO_QUEUE',$6,$7)`,[createIdentifier("review_resolution"),taskId,row.source_version_id,revision,principal.accountId,reason,now.toISOString()]);
      await database.query("UPDATE evidence_review_tasks SET task_status='QUEUED',assigned_verifier_account_id=NULL,claimed_at=NULL,decided_at=NULL,updated_at=$2 WHERE task_id=$1",[taskId,now.toISOString()]);
      await this.recordResolutionCase(database,principal,row,now);
      await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal),{action:"verification.escalation.returned",outcome:"succeeded",target:{type:"resource",reference:taskId},metadata:{revision}});
    });
  }

  async declareConflict(
    principal: AuthorizationPrincipal,
    taskId: string,
    reason: string,
    now = new Date()
  ): Promise<void> {
    const normalizedReason = normalizeReason(reason);
    await this.database.transaction(async (database) => {
      await liveVerifier(database, principal);
      const result = await database.query<TaskRow>(
        `SELECT ${TASK_COLUMNS}
           FROM evidence_review_tasks
          WHERE task_id=$1
            AND task_status IN ('QUEUED','ASSIGNED')
            AND (task_status='QUEUED' OR assigned_verifier_account_id=$2)
          FOR UPDATE`,
        [taskId, principal.accountId]
      );
      const row = result.rows[0];
      if (!row) throw new EvidenceReviewAccessError();

      await database.query(
        `INSERT INTO evidence_review_conflicts(
           conflict_id,task_id,verifier_account_id,reason,declared_at
         ) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(task_id,verifier_account_id) DO NOTHING`,
        [
          createReviewConflictId(),
          taskId,
          principal.accountId,
          normalizedReason,
          now.toISOString()
        ]
      );

      if (
        row.assigned_verifier_account_id === principal.accountId &&
        row.task_status === "ASSIGNED"
      ) {
        await database.query(
          `UPDATE evidence_review_tasks
              SET task_status='QUEUED',
                  assigned_verifier_account_id=NULL,
                  claimed_at=NULL,
                  updated_at=$2
            WHERE task_id=$1`,
          [taskId, now.toISOString()]
        );
      }
    });
  }

  async decide(
    principal: AuthorizationPrincipal,
    taskId: string,
    outcomeValue: unknown,
    reasonValue: unknown,
    now = new Date(),
    options: { assessorVisible?: boolean; confirmTrade?: boolean; expectedResolutionRevision?: number } = {}
  ): Promise<void> {
    if (options.assessorVisible !== undefined && typeof options.assessorVisible !== "boolean") throw new EvidenceReviewInputError();
    if (options.confirmTrade !== undefined && typeof options.confirmTrade !== "boolean") throw new EvidenceReviewInputError();
    const expectedResolutionRevision=options.expectedResolutionRevision===undefined?0:options.expectedResolutionRevision;
    if(!Number.isSafeInteger(expectedResolutionRevision)||expectedResolutionRevision<0||expectedResolutionRevision>2147483647)throw new EvidenceReviewInputError();
    const outcome = normalizeOutcome(outcomeValue);
    const reason = normalizeReason(reasonValue);

    let approvedIndependentIdentityId: string | null = null;

    await this.database.transaction(async (database) => {
      await liveVerifier(database, principal);
      const result = await database.query<TaskRow>(
        `SELECT ${TASK_COLUMNS}
           FROM evidence_review_tasks
          WHERE task_id=$1
            AND task_status='ASSIGNED'
            AND assigned_verifier_account_id=$2
          FOR UPDATE`,
        [taskId, principal.accountId]
      );
      const row = result.rows[0];
      if (!row) throw new EvidenceReviewAccessError();

      const conflict = await database.query(
        `SELECT 1
           FROM evidence_review_conflicts
          WHERE task_id=$1 AND verifier_account_id=$2`,
        [taskId, principal.accountId]
      );
      if (conflict.rows[0]) {
        throw new EvidenceReviewConflictError(
          "Conflicted reviewer cannot decide this task."
        );
      }

      if (!(await this.sourceIsCurrent(database, row))) {
        throw new EvidenceReviewConflictError(
          "Evidence version changed; this task is stale."
        );
      }

      const historyContract=await database.query<{relation:string|null;contract:string|null}>("SELECT to_regclass('evidence_review_resolution_events') AS relation,to_regprocedure('hse_review_resolution_rollback_contract()') AS contract");
      if(!historyContract.rows[0]?.relation&&historyContract.rows[0]?.contract)throw new EvidenceReviewConflictError("Review history contract is unavailable; finalization is blocked.");
      const historyRevision=historyContract.rows[0]?.relation
        ?(await database.query<{revision:number}>("SELECT COALESCE(MAX(revision),0)::INTEGER AS revision FROM evidence_review_resolution_events WHERE task_id=$1",[taskId])).rows[0]?.revision
        :0;
      if(historyRevision!==expectedResolutionRevision)throw new EvidenceReviewConflictError("Review history changed; reload before finalizing this task.");
      const tradeContext = options.confirmTrade === true ? await this.assignedSkillContext(database,principal,taskId) : null;
      if (options.confirmTrade === true && (outcome !== "APPROVED" || !tradeContext?.relatedTrade ||
          !tradeContext.evidenceAvailable || !tradeContext.secureFileId)) {
        throw new EvidenceReviewConflictError("Explicit trade confirmation requires the assigned current skill and available evidence.");
      }
      const inserted = await database.query(
        tradeContext
          ? `INSERT INTO evidence_review_decisions(
               decision_id,task_id,source_version_id,verifier_account_id,outcome,reason,decided_at,assessor_visible,
               verified_trade,verification_method,verification_source_file_id
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'evidence_review',$10) ON CONFLICT(task_id) DO NOTHING`
          : options.assessorVisible === true
          ? `INSERT INTO evidence_review_decisions(
               decision_id,task_id,source_version_id,verifier_account_id,outcome,reason,decided_at,assessor_visible
             ) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE) ON CONFLICT(task_id) DO NOTHING`
          : `INSERT INTO evidence_review_decisions(
               decision_id,task_id,source_version_id,verifier_account_id,outcome,reason,decided_at
             ) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(task_id) DO NOTHING`,
        [
          createReviewDecisionId(),
          taskId,
          row.source_version_id,
          principal.accountId,
          outcome,
          reason,
          now.toISOString(),
          ...(tradeContext ? [options.assessorVisible === true, tradeContext.relatedTrade, tradeContext.secureFileId] : [])
        ]
      );
      if (inserted.affectedRows !== 1) {
        throw new EvidenceReviewConflictError(
          "Evidence task already has a decision."
        );
      }

      await database.query(
        `UPDATE evidence_review_tasks
            SET task_status=$3,
                decided_at=$4,
                updated_at=$4
          WHERE task_id=$1
            AND assigned_verifier_account_id=$2`,
        [taskId, principal.accountId, outcome, now.toISOString()]
      );

      if (row.case_id && row.tenant_id) {
        await this.advanceCase(database, row, outcome, now, principal);
        await auditCaseDecision(database, principal, row.case_id, {
          reviewOutcome: outcome,
          evidenceKind: row.evidence_kind,
          sourceFingerprint: sha(row.source_version_id)
        });
      } else {
        await this.applyIndependentDecision(database, row, outcome, now);
        if (row.evidence_kind === "identity" && outcome === "APPROVED") {
          approvedIndependentIdentityId = row.source_record_id;
        }
      }
    });

    if (approvedIndependentIdentityId) {
      const issued = await this.database.query(
        "SELECT 1 FROM worker_identity_worker_ids WHERE identity_id=$1",
        [approvedIndependentIdentityId]
      );
      // A correction reviews a new version of the same permanent identity.
      // Issuance eligibility is immutable once that Worker ID exists.
      if (issued.rows[0]) return;
      const eligibility = new WorkerIdentityEligibilityService(
        new DatabaseWorkerIdentityEligibilityRepository(Promise.resolve(this.database))
      );
      const duplicateCheck = await eligibility.evaluate(approvedIndependentIdentityId);
      if (duplicateCheck.checkStatus === "clear") {
        await eligibility.issuePermanentWorkerId(approvedIndependentIdentityId);
      }
    }
  }

  async queueIndependentWorkerEvidence(
    principal: AuthorizationPrincipal,
    recordId: string,
    now = new Date()
  ): Promise<EvidenceReviewTask> {
    assertIndependentWorker(principal);
    return this.database.transaction(async (database) => {
      const result = await database.query<{
        record_id: string;
        record_kind: EvidenceReviewKind;
        version_id: string;
        secure_file_id: string | null;
      }>(
        `SELECT records.record_id,
                records.record_kind,
                versions.version_id,
                COALESCE(attachment.secure_file_id,leaving.secure_file_id) AS secure_file_id
           FROM worker_evidence_records AS records
           JOIN worker_evidence_versions AS versions
             ON versions.version_id=records.current_version_id
           LEFT JOIN LATERAL (
             SELECT secure_file_id
               FROM worker_evidence_attachments
              WHERE version_id=versions.version_id
                AND superseded_at IS NULL
              ORDER BY
                CASE attachment_kind WHEN 'primary_certificate' THEN 0 ELSE 1 END,
                created_at DESC
              LIMIT 1
           ) AS attachment ON TRUE
           LEFT JOIN LATERAL (
             SELECT secure_file_id
               FROM worker_employment_leaving_letters
              WHERE employment_version_id=versions.version_id
                AND status='active'
              ORDER BY created_at DESC
              LIMIT 1
           ) AS leaving ON records.record_kind='employment'
          WHERE records.record_id=$1
            AND records.worker_account_id=$2
            AND records.lifecycle_status <> 'inactive'
            AND versions.version_status='submitted'
          LIMIT 1`,
        [recordId, principal.accountId]
      );
      const row = result.rows[0];
      if (!row) {
        throw new EvidenceReviewConflictError(
          "Only the current submitted Worker evidence version can enter verification."
        );
      }

      await this.supersedeStaleIndependentTasks(
        database,
        principal.accountId,
        row.record_kind,
        row.record_id,
        row.version_id,
        now
      );

      return this.insertIndependentTask(
        database,
        principal.accountId,
        row.record_kind,
        row.record_id,
        row.version_id,
        row.secure_file_id,
        `${row.record_kind.replaceAll("_", " ")} evidence`,
        now
      );
    });
  }

  async queueIndependentIdentity(
    principal: AuthorizationPrincipal,
    now = new Date()
  ): Promise<EvidenceReviewTask> {
    assertIndependentWorker(principal);
    return this.database.transaction(async (database) => {
      const result = await database.query<{
        identity_id: string;
        identity_version_id: string;
        secure_file_id: string | null;
      }>(
        `SELECT identities.identity_id,
                versions.identity_version_id,
                bindings.secure_file_id
           FROM worker_identities AS identities
           JOIN worker_identity_versions AS versions
             ON versions.identity_id=identities.identity_id
            AND versions.version_number=identities.current_version_number
           LEFT JOIN LATERAL (
             SELECT secure_file_id
               FROM worker_identity_evidence_bindings
              WHERE identity_version_id=versions.identity_version_id
                AND purpose='identity_document'
                AND binding_status='active'
              ORDER BY created_at DESC
              LIMIT 1
           ) AS bindings ON TRUE
          WHERE identities.worker_account_id=$1
            AND (identities.lifecycle_status='manual_review' OR (identities.lifecycle_status='correction_pending' AND versions.version_kind='correction'))
            AND versions.version_status='submitted'
          LIMIT 1`,
        [principal.accountId]
      );
      const row = result.rows[0];
      if (!row) {
        throw new EvidenceReviewConflictError(
          "Identity must complete automated checks before entering manual verification."
        );
      }

      await this.supersedeStaleIndependentTasks(
        database,
        principal.accountId,
        "identity",
        row.identity_id,
        row.identity_version_id,
        now
      );

      return this.insertIndependentTask(
        database,
        principal.accountId,
        "identity",
        row.identity_id,
        row.identity_version_id,
        row.secure_file_id,
        "Identity document",
        now
      );
    });
  }

  private async sourceIsCurrent(
    database: DatabaseClient,
    row: TaskRow
  ): Promise<boolean> {
    if (row.evidence_kind === "identity") {
      const result = await database.query(
        `SELECT 1
           FROM worker_identity_versions AS versions
           JOIN worker_identities AS identities
             ON identities.identity_id=versions.identity_id
          WHERE versions.identity_version_id=$1
            AND identities.worker_account_id=$2
            AND versions.version_status='submitted'
            AND versions.version_number=identities.current_version_number`,
        [row.source_version_id, row.worker_account_id]
      );
      return Boolean(result.rows[0]);
    }

    if (row.evidence_kind === "supervisor_observation") {
      if (!row.case_id) return false;
      const result = await database.query(
        `SELECT 1
           FROM supervisor_observations
          WHERE observation_id=$1
            AND case_id=$2
            AND worker_account_id=$3
            AND observation_status='submitted'`,
        [row.source_version_id, row.case_id, row.worker_account_id]
      );
      return Boolean(result.rows[0]);
    }

    const result = await database.query(
      `SELECT 1
         FROM worker_evidence_versions AS versions
         JOIN worker_evidence_records AS records
           ON records.record_id=versions.record_id
        WHERE versions.version_id=$1
          AND records.record_id=$2
          AND records.worker_account_id=$3
          AND records.current_version_id=versions.version_id
          AND versions.version_status='submitted'`,
      [row.source_version_id, row.source_record_id, row.worker_account_id]
    );
    return Boolean(result.rows[0]);
  }

  private async applyIndependentDecision(
    database: DatabaseClient,
    row: TaskRow,
    outcome: EvidenceReviewOutcome | "UNABLE_TO_VERIFY",
    now: Date
  ): Promise<void> {
    if (row.evidence_kind !== "identity") return;

    const correction = await database.query<{ correction_request_id: string }>(
      `SELECT requests.correction_request_id
         FROM worker_identity_correction_requests AS requests
         JOIN worker_identities AS identities ON identities.identity_id=requests.identity_id
        WHERE requests.correction_version_id=$1
          AND requests.worker_account_id=$2
          AND identities.lifecycle_status='correction_pending'`,
      [row.source_version_id, row.worker_account_id]
    );
    if (correction.rows[0]) {
      await new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(database)).decide(
        createTrustedWorkerIdentityCorrectionAuthority(),
        {
          correctionRequestId: correction.rows[0].correction_request_id,
          decision: outcome === "APPROVED" ? "accepted" : "rejected",
          reasonCode: `manual_review_${outcome.toLowerCase()}`
        }
      );
      return;
    }

    const lifecycleStatus =
      outcome === "APPROVED"
        ? "verified"
        : outcome === "CHANGES_REQUESTED" || outcome === "UNABLE_TO_VERIFY"
          ? "more_info"
          : "rejected";

    const updated = await database.query(
      `UPDATE worker_identities AS identities
          SET lifecycle_status=$3,
              lock_version=lock_version+1,
              updated_at=$4
         FROM worker_identity_versions AS versions
        WHERE identities.identity_id=$1
          AND identities.worker_account_id=$2
          AND identities.lifecycle_status='manual_review'
          AND versions.identity_id=identities.identity_id
          AND versions.version_number=identities.current_version_number
          AND versions.identity_version_id=$5
          AND versions.version_status='submitted'`,
      [
        row.source_record_id,
        row.worker_account_id,
        lifecycleStatus,
        now.toISOString(),
        row.source_version_id
      ]
    );
    if (updated.affectedRows !== 1) {
      throw new EvidenceReviewConflictError(
        "Identity review outcome could not be applied to the current identity."
      );
    }
  }

  private async advanceCase(
    database: DatabaseClient,
    row: TaskRow,
    _outcome: EvidenceReviewOutcome,
    now: Date,
    principal: AuthorizationPrincipal
  ): Promise<void> {
    if (!row.case_id || !row.tenant_id) throw new EvidenceReviewAccessError();

    let status: string;
    let owner: string | null;
    let nextAction: string | null;

    const old = await database.query<{ case_status: string }>(
      `SELECT case_status
         FROM assurance_cases
        WHERE case_id=$1 AND tenant_id=$2
        FOR UPDATE`,
      [row.case_id, row.tenant_id]
    );
    if (!old.rows[0]) throw new EvidenceReviewAccessError();

    const pending = await this.reviewBlocker(database,row.case_id);
    if (pending) {
      const route=this.reviewBlockerRoute(pending);
      status=route.status;owner=route.owner;nextAction=route.nextAction;
    } else {
        const requirementResult = await database.query<{
          interview_required: boolean;
          assessment_framework_references: unknown;
        }>(
          `SELECT orders.interview_required,orders.assessment_framework_references
             FROM assurance_cases AS cases
             JOIN assurance_orders AS orders
               ON orders.order_id=cases.order_id
              AND orders.tenant_id=cases.tenant_id
            WHERE cases.case_id=$1 AND cases.tenant_id=$2`,
          [row.case_id, row.tenant_id]
        );
        const requirement = requirementResult.rows[0];
        const frameworkReferences = Array.isArray(requirement?.assessment_framework_references)
          ? requirement.assessment_framework_references
          : JSON.parse(String(requirement?.assessment_framework_references ?? "[]"));

        if (requirement?.interview_required && frameworkReferences.length === 0) {
          const interviews = new InterviewSchedulingService(database);
          let request = await interviews.requestInterview({
            tenantId: row.tenant_id,
            caseId: row.case_id,
            workerAccountId: row.worker_account_id,
            requestedAt: now.toISOString(),
            timezone: "UTC"
          });
          if (!request.assessorAccountId) {
            const assessorResult = await database.query<{ account_id: string }>(
              `SELECT accounts.account_id
                 FROM auth_accounts AS accounts
                 JOIN auth_account_roles AS roles
                   ON roles.account_id=accounts.account_id
                  AND roles.role='assessor'
                 LEFT JOIN interview_requests AS assignments
                   ON assignments.assessor_account_id=accounts.account_id
                  AND assignments.status IN ('ASSIGNED','WAITING_ROOM')
                WHERE accounts.account_status='active'
                GROUP BY accounts.account_id
                ORDER BY COUNT(assignments.interview_request_id) ASC,accounts.account_id ASC
                LIMIT 1`
            );
            const assessorAccountId = assessorResult.rows[0]?.account_id;
            if (assessorAccountId) {
              request = await interviews.assignInterview({
                tenantId: row.tenant_id,
                request,
                assessorAccountId
              });
            }
          }

          await database.query(
            `UPDATE assurance_cases
                SET interview_reference=$3
              WHERE case_id=$1 AND tenant_id=$2`,
            [row.case_id, row.tenant_id, request.interviewRequestId]
          );
          status = "Interview pending";
          owner = request.assessorAccountId ? "assessor" : "admin";
          nextAction = request.assessorAccountId
            ? "Assigned assessor must schedule the required interview."
            : "Assign an active assessor to the required interview.";
        } else {
          status = "Assessment pending";
          owner = "background_job";
          nextAction = "Await framework and effective-policy evaluation.";
        }
    }

    await database.query(
      `UPDATE assurance_cases
          SET case_status=$3,
              owner_kind=$4,
              next_action=$5,
              updated_at=$6,
              closed_at=CASE WHEN $3='Rejected' THEN $6 ELSE closed_at END
        WHERE case_id=$1 AND tenant_id=$2`,
      [
        row.case_id,
        row.tenant_id,
        status,
        owner,
        nextAction,
        now.toISOString()
      ]
    );

    await database.query(
      `INSERT INTO assurance_case_timeline_events(
         timeline_event_id,tenant_id,order_id,case_id,event_type,
         from_status,to_status,owner_kind,next_action,
         actor_account_id,actor_role,occurred_at
       )
       SELECT $1,cases.tenant_id,cases.order_id,cases.case_id,
              'evidence_review_decision',$2,$3,$4,$5,$6,'verifier',$7
         FROM assurance_cases AS cases
        WHERE cases.case_id=$8`,
      [
        createIdentifier("assurance_event"),
        old.rows[0].case_status,
        status,
        owner,
        nextAction,
        principal.accountId,
        now.toISOString(),
        row.case_id
      ]
    );
  }

  async queueCaseEvidence(
    principal: TenantPermissionPrincipal<"company.orders.manage">,
    caseId: string,
    now = new Date()
  ): Promise<number> {
    const scope = deriveTrustedTenantScope(principal);
    return this.database.transaction(async (database) => {
      const caseResult = await database.query<{
        worker_account_id: string;
        order_id: string;
      }>(
        `SELECT worker_account_id,order_id
           FROM assurance_cases
          WHERE case_id=$1 AND tenant_id=$2
          FOR UPDATE`,
        [caseId, scope.tenantId]
      );
      const assuranceCase = caseResult.rows[0];
      if (!assuranceCase) throw new EvidenceReviewAccessError();

      const orderResult = await database.query<{
        requested_identity_checks: unknown;
        requested_evidence_checks: unknown;
      }>(
        `SELECT requested_identity_checks,requested_evidence_checks
           FROM assurance_orders
          WHERE order_id=$1 AND tenant_id=$2`,
        [assuranceCase.order_id, scope.tenantId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new EvidenceReviewAccessError();

      const identityChecks = Array.isArray(order.requested_identity_checks)
        ? order.requested_identity_checks
        : JSON.parse(String(order.requested_identity_checks ?? "[]"));
      const evidenceChecks = Array.isArray(order.requested_evidence_checks)
        ? order.requested_evidence_checks
        : JSON.parse(String(order.requested_evidence_checks ?? "[]"));

      let count = 0;
      if (identityChecks.length > 0) {
        const identity = await database.query<{
          identity_id: string;
          identity_version_id: string;
          secure_file_id: string | null;
        }>(
          `SELECT identities.identity_id,
                  versions.identity_version_id,
                  bindings.secure_file_id
             FROM worker_identities AS identities
             JOIN worker_identity_versions AS versions
               ON versions.identity_id=identities.identity_id
              AND versions.version_number=identities.current_version_number
             LEFT JOIN worker_identity_evidence_bindings AS bindings
               ON bindings.identity_version_id=versions.identity_version_id
              AND bindings.purpose='identity_document'
              AND bindings.binding_status='active'
            WHERE identities.worker_account_id=$1
              AND versions.version_status='submitted'
            LIMIT 1`,
          [assuranceCase.worker_account_id]
        );
        if (identity.rows[0]) {
          count += await this.insertCaseTask(
            database,
            scope.tenantId,
            caseId,
            assuranceCase.worker_account_id,
            "identity",
            identity.rows[0].identity_id,
            identity.rows[0].identity_version_id,
            identity.rows[0].secure_file_id,
            "Identity document",
            now
          );
        }
      }

      for (const kind of evidenceChecks.filter(
        (value: unknown): value is "qualification" | "experience" | "employment" | "skill" =>
          typeof value === "string" &&
          ["qualification", "experience", "employment", "skill"].includes(value)
      )) {
        const evidence = await database.query<{
          record_id: string;
          version_id: string;
          secure_file_id: string | null;
        }>(
          `SELECT records.record_id,
                  versions.version_id,
                  COALESCE(attachment.secure_file_id,leaving.secure_file_id) AS secure_file_id
             FROM worker_evidence_records AS records
             JOIN worker_evidence_versions AS versions
               ON versions.version_id=records.current_version_id
             LEFT JOIN LATERAL (
               SELECT secure_file_id
                 FROM worker_evidence_attachments
                WHERE version_id=versions.version_id
                  AND superseded_at IS NULL
                ORDER BY created_at
                LIMIT 1
             ) AS attachment ON TRUE
             LEFT JOIN LATERAL (
               SELECT secure_file_id
                 FROM worker_employment_leaving_letters
                WHERE employment_version_id=versions.version_id
                  AND status='active'
                  AND $2='employment'
                ORDER BY created_at DESC
                LIMIT 1
             ) AS leaving ON TRUE
            WHERE records.worker_account_id=$1
              AND records.record_kind=$2
              AND versions.version_status='submitted'
            ORDER BY records.updated_at DESC
            LIMIT 1`,
          [assuranceCase.worker_account_id, kind]
        );
        if (evidence.rows[0]) {
          count += await this.insertCaseTask(
            database,
            scope.tenantId,
            caseId,
            assuranceCase.worker_account_id,
            kind,
            evidence.rows[0].record_id,
            evidence.rows[0].version_id,
            evidence.rows[0].secure_file_id,
            `${kind} evidence`,
            now
          );
        }
      }

      const observations = await database.query<{
        observation_id: string;
        competency_reference: string;
      }>(
        `SELECT observation_id,competency_reference
           FROM supervisor_observations
          WHERE tenant_id=$1
            AND case_id=$2
            AND worker_account_id=$3
            AND observation_status='submitted'`,
        [scope.tenantId, caseId, assuranceCase.worker_account_id]
      );
      for (const observation of observations.rows) {
        count += await this.insertCaseTask(
          database,
          scope.tenantId,
          caseId,
          assuranceCase.worker_account_id,
          "supervisor_observation",
          observation.observation_id,
          observation.observation_id,
          null,
          `Supervisor observation: ${observation.competency_reference}`,
          now
        );
      }

      const state = await database.query<{
        total_count: number | string;
        actionable_count: number | string;
      }>(
        `SELECT
           COUNT(*)::int AS total_count,
           COUNT(*) FILTER (WHERE task_status IN ('QUEUED','ASSIGNED'))::int AS actionable_count
           FROM evidence_review_tasks
          WHERE case_id=$1`,
        [caseId]
      );
      const total = Number(state.rows[0]?.total_count ?? 0);
      const actionable = Number(state.rows[0]?.actionable_count ?? 0);

      if (actionable > 0) {
        await database.query(
          `UPDATE assurance_cases
              SET case_status='Review pending',
                  owner_kind='reviewer',
                  next_action='Reviewer must verify the queued evidence.',
                  updated_at=$3
            WHERE case_id=$1 AND tenant_id=$2`,
          [caseId, scope.tenantId, now.toISOString()]
        );
      } else if (total === 0) {
        await database.query(
          `UPDATE assurance_cases
              SET case_status='Evidence pending',
                  owner_kind='worker',
                  next_action='Submit the required current evidence before review.',
                  updated_at=$3
            WHERE case_id=$1 AND tenant_id=$2`,
          [caseId, scope.tenantId, now.toISOString()]
        );
      }
      return count;
    });
  }

  private async insertCaseTask(
    database: DatabaseClient,
    tenantId: string,
    caseId: string,
    workerAccountId: string,
    kind: EvidenceReviewKind,
    recordId: string,
    versionId: string,
    fileId: string | null,
    label: string,
    now: Date
  ): Promise<number> {
    const result = await database.query(
      `INSERT INTO evidence_review_tasks(
         task_id,tenant_id,case_id,worker_account_id,evidence_kind,
         source_record_id,source_version_id,secure_file_id,evidence_label,
         task_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'QUEUED',$10,$10)
       ON CONFLICT(case_id,evidence_kind,source_version_id) DO NOTHING`,
      [
        createReviewTaskId(),
        tenantId,
        caseId,
        workerAccountId,
        kind,
        recordId,
        versionId,
        fileId,
        label,
        now.toISOString()
      ]
    );
    return result.affectedRows === 1 ? 1 : 0;
  }

  private async supersedeStaleIndependentTasks(
    database: DatabaseClient,
    workerAccountId: string,
    kind: EvidenceReviewKind,
    recordId: string,
    currentVersionId: string,
    now: Date
  ): Promise<void> {
    await database.query(
      `UPDATE evidence_review_tasks
          SET task_status='SUPERSEDED',
              updated_at=$5
        WHERE tenant_id IS NULL
          AND case_id IS NULL
          AND worker_account_id=$1
          AND evidence_kind=$2
          AND source_record_id=$3
          AND source_version_id<>$4
          AND task_status IN ('QUEUED','ASSIGNED','UNABLE_TO_VERIFY','ESCALATED')`,
      [
        workerAccountId,
        kind,
        recordId,
        currentVersionId,
        now.toISOString()
      ]
    );
  }

  private async insertIndependentTask(
    database: DatabaseClient,
    workerAccountId: string,
    kind: EvidenceReviewKind,
    recordId: string,
    versionId: string,
    fileId: string | null,
    label: string,
    now: Date
  ): Promise<EvidenceReviewTask> {
    const inserted = await database.query<TaskRow>(
      `INSERT INTO evidence_review_tasks(
         task_id,tenant_id,case_id,worker_account_id,evidence_kind,
         source_record_id,source_version_id,secure_file_id,evidence_label,
         task_status,created_at,updated_at
       ) VALUES($1,NULL,NULL,$2,$3,$4,$5,$6,$7,'QUEUED',$8,$8)
       ON CONFLICT DO NOTHING
       RETURNING ${TASK_COLUMNS}`,
      [
        createReviewTaskId(),
        workerAccountId,
        kind,
        recordId,
        versionId,
        fileId,
        label,
        now.toISOString()
      ]
    );
    if (inserted.rows[0]) return task(inserted.rows[0]);

    const existing = await database.query<TaskRow>(
      `SELECT ${TASK_COLUMNS}
         FROM evidence_review_tasks
        WHERE tenant_id IS NULL
          AND case_id IS NULL
          AND worker_account_id=$1
          AND evidence_kind=$2
          AND source_version_id=$3
        ORDER BY created_at DESC
        LIMIT 1`,
      [workerAccountId, kind, versionId]
    );
    if (!existing.rows[0]) {
      throw new EvidenceReviewConflictError(
        "Independent review task could not be created."
      );
    }
    return task(existing.rows[0]);
  }

  async addSupervisorObservation(
    principal: TenantPermissionPrincipal<"company.orders.manage">,
    input: {
      caseId: string;
      competencyReference: string;
      observedAt: Date;
      observationText: string;
      outcome: string;
    },
    now = new Date()
  ): Promise<string> {
    const scope = deriveTrustedTenantScope(principal);
    const competency = input.competencyReference.trim();
    const observationText = input.observationText.trim();
    if (
      competency.length < 2 ||
      competency.length > 160 ||
      observationText.length < 20 ||
      observationText.length > 6000 ||
      !["demonstrated", "partially_demonstrated", "not_demonstrated"].includes(
        input.outcome
      )
    ) {
      throw new EvidenceReviewInputError();
    }

    return this.database.transaction(async (database) => {
      const assuranceCase = await database.query<{ worker_account_id: string }>(
        `SELECT worker_account_id
           FROM assurance_cases
          WHERE case_id=$1 AND tenant_id=$2`,
        [input.caseId, scope.tenantId]
      );
      if (!assuranceCase.rows[0]) throw new EvidenceReviewAccessError();

      const id = createSupervisorObservationId();
      await database.query(
        `INSERT INTO supervisor_observations(
           observation_id,tenant_id,case_id,worker_account_id,
           competency_reference,observer_membership_id,observed_at,
           observation_text,outcome,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          scope.tenantId,
          input.caseId,
          assuranceCase.rows[0].worker_account_id,
          competency,
          scope.membershipId,
          input.observedAt.toISOString(),
          observationText,
          input.outcome,
          now.toISOString()
        ]
      );
      return id;
    });
  }

  async preview(
    principal: AuthorizationPrincipal,
    taskId: string,
    now = new Date()
  ) {
    assertVerifierPrincipal(principal);
    const reviewTask = await this.findTask(principal, taskId);
    if (
      !reviewTask ||
      reviewTask.assignedVerifierAccountId !== principal.accountId ||
      !reviewTask.secureFileId
    ) {
      throw new EvidenceReviewAccessError();
    }
    const environment = getServerEnvironment();
    const lookup = this.delegatedLookup(reviewTask);
    const issued = await authorizeSecureFileAccessCore({
      principal,
      fileRef: reviewTask.secureFileId,
      purpose: "preview",
      signingSecret: environment.sessionSecret,
      repository: lookup,
      now
    });
    return readSecureFileAccessCore({
      principal,
      token: issued.token,
      expectedPurpose: "preview",
      signingSecret: environment.sessionSecret,
      repository: lookup,
      storage: createRuntimePrivateObjectStorage(environment.appEnvironment),
      now
    });
  }

  private delegatedLookup(reviewTask: EvidenceReviewTask): SecureFileAccessLookup {
    return {
      findForPrincipal: async (principal, fileId) => this.database.transaction(async database => {
        await liveVerifier(database, principal);
        if (fileId !== reviewTask.secureFileId) return null;
        const result = await database.query<SecureFileRow>(
          `SELECT files.*
             FROM evidence_review_tasks tasks
             JOIN platform_secure_files files ON files.file_id=tasks.secure_file_id
               AND files.owner_account_id=tasks.worker_account_id AND files.owner_role='worker'
               AND files.lifecycle_status='available'
            WHERE tasks.task_id=$1 AND tasks.assigned_verifier_account_id=$2
              AND files.file_id=$3 AND tasks.task_status IN ('ASSIGNED','APPROVED','REJECTED','CHANGES_REQUESTED')
              AND ((tasks.tenant_id IS NULL AND tasks.case_id IS NULL)
                OR EXISTS(SELECT 1 FROM assurance_cases cases WHERE cases.case_id=tasks.case_id
                  AND cases.tenant_id=tasks.tenant_id AND cases.worker_account_id=tasks.worker_account_id))
              AND (
                (tasks.evidence_kind='identity' AND EXISTS(
                  SELECT 1 FROM worker_identities identities
                  JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id
                    AND versions.version_number=identities.current_version_number AND versions.version_status='submitted'
                  JOIN worker_identity_evidence_bindings bindings ON bindings.identity_version_id=versions.identity_version_id
                    AND bindings.worker_account_id=identities.worker_account_id AND bindings.purpose='identity_document'
                    AND bindings.binding_status='active' AND bindings.secure_file_id=files.file_id
                  WHERE identities.identity_id=tasks.source_record_id AND versions.identity_version_id=tasks.source_version_id
                    AND identities.worker_account_id=tasks.worker_account_id))
                OR (tasks.evidence_kind IN ('qualification','experience','employment','skill') AND EXISTS(
                  SELECT 1 FROM worker_evidence_records records
                  JOIN worker_evidence_versions versions ON versions.record_id=records.record_id
                    AND versions.version_id=records.current_version_id AND versions.version_status='submitted'
                  WHERE records.record_id=tasks.source_record_id AND records.worker_account_id=tasks.worker_account_id
                    AND records.record_kind=tasks.evidence_kind AND versions.version_id=tasks.source_version_id
                    AND (EXISTS(SELECT 1 FROM worker_evidence_attachments attachments
                      WHERE attachments.record_id=records.record_id AND attachments.version_id=versions.version_id
                        AND attachments.secure_file_id=files.file_id AND attachments.superseded_at IS NULL)
                      OR EXISTS(SELECT 1 FROM worker_employment_leaving_letters letters
                        WHERE letters.employment_record_id=records.record_id AND letters.employment_version_id=versions.version_id
                          AND letters.secure_file_id=files.file_id AND letters.status='active'))))
              )`,
          [reviewTask.taskId, principal.accountId, fileId]
        );
        return result.rows[0] ? secureFileFromRow(result.rows[0]) : null;
      })
    };
  }
}

export async function getEvidenceReviewService(): Promise<EvidenceReviewService> {
  return new EvidenceReviewService(await getDatabaseClient());
}
