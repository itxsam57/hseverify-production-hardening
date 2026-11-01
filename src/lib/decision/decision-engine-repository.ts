import "server-only";

import { createIdentifier } from "../auth/auth-domain";
import { CertificationRecordRepository } from "../credential/certification-record-repository";
import { issueCredential } from "../credential/credential-issuance-domain";
import { derivePinnedCredentialValidity } from "../credential/credential-validity-domain";
import { CredentialIssuanceRepository } from "../credential/credential-issuance-repository";
import { finalizeExplicitReassessmentReplacement } from "../credential/credential-reassessment-replacement-service";
import { getDatabaseClient } from "../database/database";
import { InterviewSchedulingService } from "../interview/interview-scheduling-service";
import { appendLivingCompetencyVersion, createLivingCompetencyRecord } from "../living-record/living-record-domain";
import { LivingRecordRepository } from "../living-record/living-record-repository";
import type { DecisionRecord, DecisionState, ManualDecisionOverride } from "./decision-engine-domain";


type AssuranceDecisionProjection = Readonly<{
  caseStatus:
    | "Approved"
    | "Conditionally approved"
    | "Review pending"
    | "Evidence pending"
    | "Interview pending"
    | "Reassessment required"
    | "Rejected"
    | "Suspended"
    | "Closed";
  owner: "worker" | "reviewer" | "assessor" | "admin" | null;
  nextAction: string | null;
  terminal: boolean;
}>;

function assuranceProjection(state: DecisionState): AssuranceDecisionProjection {
  switch (state) {
    case "APPROVED":
      return { caseStatus: "Approved", owner: null, nextAction: null, terminal: true };
    case "CONDITIONALLY_APPROVED":
      return { caseStatus: "Conditionally approved", owner: null, nextAction: null, terminal: true };
    case "PENDING_ADDITIONAL_REVIEW":
      return {
        caseStatus: "Review pending",
        owner: "reviewer",
        nextAction: "Complete the additional review required by the current decision.",
        terminal: false
      };
    case "ADDITIONAL_EVIDENCE_REQUIRED":
      return {
        caseStatus: "Evidence pending",
        owner: "worker",
        nextAction: "Submit the additional evidence required by the current decision.",
        terminal: false
      };
    case "INTERVIEW_PENDING":
      return {
        caseStatus: "Interview pending",
        owner: "assessor",
        nextAction: "Complete the interview required by the current decision.",
        terminal: false
      };
    case "REASSESSMENT_REQUIRED":
      return {
        caseStatus: "Reassessment required",
        owner: "worker",
        nextAction: "Complete the reassessment required by the current decision.",
        terminal: false
      };
    case "REJECTED":
      return { caseStatus: "Rejected", owner: null, nextAction: null, terminal: true };
    case "SUSPENDED":
      return {
        caseStatus: "Suspended",
        owner: "admin",
        nextAction: "Review the suspended Assurance Case before resuming or closing it.",
        terminal: false
      };
    case "REVOKED":
    case "EXPIRED":
      return { caseStatus: "Closed", owner: null, nextAction: null, terminal: true };
  }
}

export class DecisionRepository {
  constructor(
    private readonly clientPromise = getDatabaseClient(),
    private readonly signingSecret?: string
  ) {}

  private async applyOverrideStateWithClient(client: Awaited<typeof this.clientPromise>, override: ManualDecisionOverride): Promise<void> {
    const result = await client.query(
      `UPDATE platform_decisions
       SET state=$1
       WHERE decision_id=$2 AND tenant_id=$3 AND state=$4`,
      [override.newState, override.decisionId, override.tenantId, override.previousState]
    );
    if (result.affectedRows !== 1) {
      throw new Error("Decision override target could not be updated within the tenant boundary.");
    }
  }

  private async saveDecisionWithClient(
    client: Awaited<typeof this.clientPromise>,
    decision: DecisionRecord
  ): Promise<void> {
    await client.query(
      `INSERT INTO platform_decisions
       (decision_id, case_id, tenant_id, state, reason_code, explanation, rule_version, input_references, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        decision.decisionId,
        decision.caseId,
        decision.tenantId,
        decision.state,
        decision.reason.code,
        decision.reason.explanation,
        decision.ruleVersion,
        JSON.stringify(decision.inputReferences),
        decision.createdAt
      ]
    );
  }

  async saveDecision(decision: DecisionRecord): Promise<void> {
    const client = await this.clientPromise;
    await this.saveDecisionWithClient(client, decision);
  }

  private async issueCredentialForPositiveDecision(
    client: Awaited<typeof this.clientPromise>,
    decision: DecisionRecord,
    actorAccountId: string
  ): Promise<string | null> {
    if (decision.state !== "APPROVED" && decision.state !== "CONDITIONALLY_APPROVED") {
      return null;
    }

    const caseResult = await client.query<{
      worker_account_id: string;
      permanent_worker_id: string | null;
      credential_reference: string | null;
      credential_target: string | null;
    }>(
      `SELECT cases.worker_account_id,cases.permanent_worker_id,cases.credential_reference,
              orders.credential_target
         FROM assurance_cases AS cases
         JOIN assurance_orders AS orders
           ON orders.order_id=cases.order_id
          AND orders.tenant_id=cases.tenant_id
        WHERE cases.tenant_id=$1 AND cases.case_id=$2
        FOR UPDATE`,
      [decision.tenantId, decision.caseId]
    );
    const row = caseResult.rows[0];
    if (!row) throw new Error("Decision target Assurance Case does not exist in the tenant boundary.");
    if (!row.credential_target?.trim()) return null;
    if (row.credential_reference) return row.credential_reference;

    let permanentWorkerId = row.permanent_worker_id?.trim() || null;
    if (!permanentWorkerId) {
      const workerIdResult = await client.query<{ permanent_worker_id: string }>(
        `SELECT permanent_worker_id
           FROM worker_identity_worker_ids
          WHERE worker_account_id=$1
          ORDER BY issued_at DESC
          LIMIT 1`,
        [row.worker_account_id]
      );
      permanentWorkerId = workerIdResult.rows[0]?.permanent_worker_id ?? null;
    }
    if (!permanentWorkerId) {
      throw new Error("Approved credential-target Case is missing a permanent Worker ID.");
    }

    const snapshotResult = await client.query<{ snapshot_id: string; tenant_id: string; global_policy_version_id: string; effective_value_json: unknown }>(
      `SELECT snapshot_id,tenant_id,global_policy_version_id,effective_value_json
         FROM assurance_case_policy_snapshots WHERE case_id=$1`,
      [decision.caseId]
    );
    const snapshot = snapshotResult.rows[0];
    if (snapshot && snapshot.tenant_id !== decision.tenantId) throw new Error("Credential validity policy snapshot is outside the case tenant boundary.");
    const pinnedValidity = derivePinnedCredentialValidity(snapshot ? {
      snapshotId: snapshot.snapshot_id, policyVersionId: snapshot.global_policy_version_id, effectiveValue: snapshot.effective_value_json
    } : null, decision.createdAt);
    const signingEnvironment = this.signingSecret ? null : (await import("../config/server-environment")).getServerEnvironment();
    const signingSecret = this.signingSecret ?? signingEnvironment?.credentialSigningSecret;
    if (!signingSecret) throw new Error("Credential signing key is not configured.");
    const credential = issueCredential(
      {
        workerId: permanentWorkerId,
        qualification: row.credential_target.trim(),
        issuedAt: decision.createdAt,
        expiresAt: pinnedValidity.expiresAt,
        validity: pinnedValidity.validity
      },
      decision.decisionId,
      signingSecret
    );
    await new CredentialIssuanceRepository(Promise.resolve(client)).save(credential);

    await new CertificationRecordRepository(Promise.resolve(client)).create({
      certificationId: createIdentifier("certification"),
      credentialId: credential.credentialId,
      workerId: permanentWorkerId,
      qualification: credential.qualification,
      status: decision.state === "CONDITIONALLY_APPROVED" ? "conditionally_approved" : "approved",
      decisionReason: decision.reason.explanation,
      createdBy: actorAccountId,
      createdAt: decision.createdAt
    });

    await new LivingRecordRepository(Promise.resolve(client)).replaceCompetencyRecord(
      permanentWorkerId,
      createLivingCompetencyRecord({
        competencyId: createIdentifier("competency"),
        title: credential.qualification,
        sourceCredentialId: credential.credentialId,
        initial: {
          status: "valid",
          effectiveAt: decision.createdAt,
          expiresAt: credential.expiresAt,
          restrictions: [],
          conditions:
            decision.state === "CONDITIONALLY_APPROVED"
              ? [decision.reason.explanation]
              : [],
          reassessment: { required: false, dueAt: null, reason: null }
        }
      })
    );

    const linked = await client.query(
      `UPDATE assurance_cases
          SET permanent_worker_id=COALESCE(permanent_worker_id,$3),
              credential_reference=$4,
              updated_at=$5
        WHERE tenant_id=$1 AND case_id=$2 AND credential_reference IS NULL`,
      [
        decision.tenantId,
        decision.caseId,
        permanentWorkerId,
        credential.credentialId,
        decision.createdAt
      ]
    );
    if (linked.affectedRows !== 1) {
      throw new Error("Credential could not be linked to the Assurance Case.");
    }
    await finalizeExplicitReassessmentReplacement(client,decision,actorAccountId,credential.credentialId,
      [signingSecret,...(signingEnvironment?.credentialSigningPreviousSecrets ?? [])]);
    return credential.credentialId;
  }


  private async resolvePendingDecisionWork(
    client: Awaited<typeof this.clientPromise>,
    input: Readonly<{tenantId: string; caseId: string; workerAccountId: string; state: DecisionState}>
  ): Promise<AssuranceDecisionProjection> {
    const base = assuranceProjection(input.state);
    if (input.state === "PENDING_ADDITIONAL_REVIEW") {
      // Only a submitted case-bound attempt can enter the independent
      // scoring-assignment queue. A bare decision label creates no work.
      const source = await client.query<{reviewer_assigned: boolean}>(
        `SELECT EXISTS (
            SELECT 1 FROM written_score_reviews AS reviews
            WHERE reviews.attempt_id=attempts.attempt_id
              AND reviews.case_id=cases.case_id AND reviews.status='DRAFT'
              AND reviews.reviewer_account_id IS NOT NULL
          ) AS reviewer_assigned
          FROM assurance_cases AS cases
          JOIN assessment_attempts AS attempts
            ON attempts.attempt_id=cases.assessment_reference
           AND attempts.case_id=cases.case_id
           AND attempts.worker_account_id=cases.worker_account_id
         WHERE cases.case_id=$1 AND cases.tenant_id=$2
           AND attempts.status IN ('SUBMITTED','AUTO_SUBMITTED')`,
        [input.caseId,input.tenantId]
      );
      if (!source.rows[0]) throw new Error("Additional review requires a submitted assessment review source.");
      return source.rows[0].reviewer_assigned
        ? base
        : {caseStatus:"Review pending",owner:"admin",
           nextAction:"Assign an independent Verifier to review the submitted assessment.",
           terminal:false};
    }
    if (input.state === "INTERVIEW_PENDING") {
      const existing = await client.query<{interview_request_id:string;assessor_account_id:string|null}>(
        `SELECT interview_request_id,assessor_account_id
           FROM interview_requests
          WHERE tenant_id=$1 AND case_id=$2 AND worker_account_id=$3
            AND status IN ('REQUESTED','ASSIGNED','WAITING_ROOM')
          ORDER BY requested_at DESC,interview_request_id DESC
          LIMIT 1 FOR UPDATE`,
        [input.tenantId,input.caseId,input.workerAccountId]
      );
      let reference: string;
      let assessor: string | null;
      if (existing.rows[0]) {
        reference = existing.rows[0].interview_request_id;
        assessor = existing.rows[0].assessor_account_id;
      } else {
        const request = await new InterviewSchedulingService(client).requestAdditionalInterview({
          tenantId:input.tenantId,caseId:input.caseId,
          workerAccountId:input.workerAccountId,requestedAt:new Date().toISOString(),
          timezone:"UTC"
        });
        reference = request.interviewRequestId;
        assessor = request.assessorAccountId;
      }
      await client.query(
        "UPDATE assurance_cases SET interview_reference=$3 WHERE tenant_id=$1 AND case_id=$2",
        [input.tenantId,input.caseId,reference]
      );
      return assessor
        ? {caseStatus:"Interview pending",owner:"assessor",
           nextAction:"Assigned Assessor must schedule and complete the required interview.",
           terminal:false}
        : {caseStatus:"Interview pending",owner:"admin",
           nextAction:"Assign an eligible Assessor to the requested interview.",
           terminal:false};
    }
    return base;
  }

  private async applyDecisionToAssuranceCase(
    client: Awaited<typeof this.clientPromise>,
    input: Readonly<{
      tenantId: string;
      caseId: string;
      decisionId: string;
      state: DecisionState;
      actorAccountId: string;
      eventType: "decision_recorded" | "decision_override_applied";
      expectedCaseStatus?: string;
    }>
  ): Promise<void> {
    const caseResult = await client.query<{
      order_id: string;
      worker_account_id: string;
      case_status: string;
    }>(
      `SELECT order_id,worker_account_id,case_status
         FROM assurance_cases
        WHERE tenant_id=$1 AND case_id=$2
        FOR UPDATE`,
      [input.tenantId, input.caseId]
    );
    const assuranceCase = caseResult.rows[0];
    if (!assuranceCase) {
      throw new Error("Decision target Assurance Case does not exist in the tenant boundary.");
    }
    if (
      input.expectedCaseStatus &&
      assuranceCase.case_status !== input.expectedCaseStatus
    ) {
      throw new Error("Decision target Assurance Case state no longer matches the expected decision state.");
    }

    const projection = await this.resolvePendingDecisionWork(client, {
      tenantId:input.tenantId,caseId:input.caseId,
      workerAccountId:assuranceCase.worker_account_id,state:input.state
    });
    const now = new Date().toISOString();
    const updated = await client.query(
      `UPDATE assurance_cases
          SET case_status=$3,
              owner_kind=$4,
              next_action=$5,
              decision_reference=$6,
              updated_at=$7,
              closed_at=CASE WHEN $8 THEN COALESCE(closed_at,$7) ELSE NULL END
        WHERE tenant_id=$1 AND case_id=$2`,
      [
        input.tenantId,
        input.caseId,
        projection.caseStatus,
        projection.owner,
        projection.nextAction,
        input.decisionId,
        now,
        projection.terminal
      ]
    );
    if (updated.affectedRows !== 1) {
      throw new Error("Decision could not update the Assurance Case.");
    }

    await client.query(
      `UPDATE assurance_action_items
          SET action_status='resolved',updated_at=$3
        WHERE tenant_id=$1 AND case_id=$2 AND action_status<>'resolved'`,
      [input.tenantId, input.caseId, now]
    );
    if (projection.owner && projection.nextAction) {
      let deepLink = `/company/assurance-orders/${assuranceCase.order_id}#${input.caseId}`;
      if (input.state === "PENDING_ADDITIONAL_REVIEW") {
        deepLink = projection.owner === "reviewer"
          ? "/verifier/reviews/scoring"
          : `/admin/operations/scoring-assignments#${input.caseId}`;
      } else if (input.state === "ADDITIONAL_EVIDENCE_REQUIRED" ||
                 input.state === "REASSESSMENT_REQUIRED") {
        deepLink = `/worker/assurance-cases/${input.caseId}`;
      } else if (input.state === "INTERVIEW_PENDING") {
        if (projection.owner === "assessor") {
          const current = await client.query<{interview_reference:string|null}>(
            "SELECT interview_reference FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2",
            [input.caseId,input.tenantId]
          );
          const interviewId = current.rows[0]?.interview_reference;
          if (!interviewId) throw new Error("Assigned interview has no case-bound request.");
          deepLink = `/assessor/interviews/${interviewId}`;
        } else {
          deepLink = "/admin/assessor-matching";
        }
      }
      await client.query(
        `INSERT INTO assurance_action_items(
           action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,
           due_at,owner_kind,allowed_action,deep_link,statutory,action_status,
           created_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,'warning',$6,NULL,$7,'open_case',$8,false,'open',$9,$9)`,
        [
          createIdentifier("assurance_action"),
          input.tenantId,
          assuranceCase.order_id,
          input.caseId,
          assuranceCase.worker_account_id,
          projection.nextAction,
          projection.owner,
          deepLink,
          now
        ]
      );
    }

    await client.query(
      `INSERT INTO assurance_case_timeline_events(
         timeline_event_id,tenant_id,order_id,case_id,event_type,from_status,
         to_status,owner_kind,next_action,actor_account_id,actor_role,occurred_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'admin',$11)`,
      [
        createIdentifier("assurance_event"),
        input.tenantId,
        assuranceCase.order_id,
        input.caseId,
        input.eventType,
        assuranceCase.case_status,
        projection.caseStatus,
        projection.owner,
        projection.nextAction,
        input.actorAccountId,
        now
      ]
    );

    const openCases = await client.query<{ count: number | string }>(
      `SELECT COUNT(*) AS count
         FROM assurance_cases
        WHERE tenant_id=$1
          AND order_id=$2
          AND case_status NOT IN ('Approved','Conditionally approved','Rejected','Closed')`,
      [input.tenantId, assuranceCase.order_id]
    );
    const complete = Number(openCases.rows[0]?.count ?? 0) === 0;
    await client.query(
      `UPDATE assurance_orders
          SET order_status=$3,updated_at=$4
        WHERE tenant_id=$1
          AND order_id=$2
          AND order_status IN ('SUBMITTED','PARTIALLY_FUNDED','ACTIVE','COMPLETED')`,
      [
        input.tenantId,
        assuranceCase.order_id,
        complete ? "COMPLETED" : "ACTIVE",
        now
      ]
    );
  }



  private async validatedAcceptedRenewalSource(
    client: Awaited<typeof this.clientPromise>,
    decision: DecisionRecord,
    actorAccountId: string,
    renewalAppealId: string | undefined
  ): Promise<boolean> {
    if (!renewalAppealId) { if(decision.reason.code==="accepted_appeal_renewal") throw new Error("Trusted accepted renewal proof did not reach Decision Engine."); return false; }
    if (decision.reason.code !== "accepted_appeal_renewal" ||
        !decision.inputReferences.includes(renewalAppealId)) {
      throw new Error("Renewal proof does not match the independently accepted decision source.");
    }
    const proven = await client.query<{source_case_id:string;credential_id:string;original_state:string}>(
      `SELECT source.case_id AS source_case_id,appeal.credential_id,previous.state AS original_state
         FROM credential_appeals AS appeal
         JOIN credential_issuances AS credential
           ON credential.credential_id=appeal.credential_id
          AND credential.worker_id=appeal.worker_id
         JOIN assurance_cases AS source
           ON source.credential_reference=credential.credential_id
          AND source.permanent_worker_id=appeal.worker_id
         JOIN platform_decisions AS previous
           ON previous.decision_id=source.decision_reference
          AND previous.tenant_id=source.tenant_id
         JOIN assurance_cases AS target
           ON target.case_id=$1
          AND target.tenant_id=source.tenant_id
          AND target.worker_account_id=source.worker_account_id
          AND target.permanent_worker_id=source.permanent_worker_id
        WHERE appeal.appeal_id=$2
          AND appeal.status='accepted' AND appeal.outcome_action='renew'
          AND appeal.reviewer_account_id=$3
          AND appeal.reviewer_account_id<>source.worker_account_id
          AND appeal.reviewed_at=$4
          AND previous.state IN ('APPROVED','CONDITIONALLY_APPROVED')
          AND NOT EXISTS (
            SELECT 1 FROM assurance_case_timeline_events AS prior
             WHERE prior.case_id=source.case_id AND prior.tenant_id=source.tenant_id
               AND prior.event_type='decision_recorded'
               AND prior.actor_account_id=$3
          )
          AND NOT EXISTS (
            SELECT 1 FROM credential_replacements AS replacement
             WHERE replacement.appeal_id=appeal.appeal_id
                OR replacement.old_credential_id=appeal.credential_id
          )
        FOR SHARE OF appeal,credential,source,previous`,
      [decision.caseId,renewalAppealId,actorAccountId,decision.createdAt]
    );
    const row=proven.rows[0];
    if (proven.rows.length!==1 || !row ||
        !decision.inputReferences.includes(row.source_case_id) ||
        !decision.inputReferences.includes(row.credential_id) ||
        (row.original_state==="CONDITIONALLY_APPROVED" ? "CONDITIONALLY_APPROVED":"APPROVED")!==decision.state) {
      throw new Error("Independently accepted renewal source cannot be authenticated for this case.");
    }
    return true;
  }

  private async assertPositiveDecisionPrerequisites(
    client: Awaited<typeof this.clientPromise>,
    decision: DecisionRecord,
    actorAccountId: string,
    acceptedRenewalAppealId?: string
  ): Promise<void> {
    const {tenantId,caseId,state}=decision;
    if (state !== "APPROVED" && state !== "CONDITIONALLY_APPROVED") return;
    // Renewal reuses a signed, previously approved credential ONLY after a
    // separately verified independent accepted-appeal review. It is not a
    // shortcut for an ordinary assessment or an explicit reassessment.
    const acceptedRenewal = await this.validatedAcceptedRenewalSource(
      client,decision,actorAccountId,acceptedRenewalAppealId
    );
    if (acceptedRenewal) return;

    // An Admin's reason/input references are not evidence that mandatory
    // assessment and interview stages actually completed.
    const requirements = await client.query<{
      worker_account_id: string;
      assessment_required: boolean;
      interview_required: boolean;
      interview_reference: string | null;
    }>(
      `SELECT cases.worker_account_id,
              jsonb_array_length(orders.assessment_framework_references) > 0 AS assessment_required,
              orders.interview_required,cases.interview_reference
         FROM assurance_cases AS cases
         JOIN assurance_orders AS orders
           ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id
        WHERE cases.tenant_id=$1 AND cases.case_id=$2
        FOR UPDATE OF cases`,
      [tenantId, caseId]
    );
    const row = requirements.rows[0];
    if (!row) throw new Error("Decision target Assurance Case does not exist in the tenant boundary.");

    if (row.assessment_required) {
      const passing = await client.query<{ eligible: boolean }>(
        `SELECT EXISTS(
           SELECT 1
             FROM assessment_attempts AS attempt
            WHERE attempt.case_id=$1 AND attempt.worker_account_id=$2
              AND attempt.status='SUBMITTED'
              AND NOT EXISTS (
                SELECT 1 FROM assessment_attempts AS newer
                 WHERE newer.case_id=attempt.case_id
                   AND (newer.started_at,newer.attempt_id) > (attempt.started_at,attempt.attempt_id)
              )
              AND (
                EXISTS (
                  SELECT 1 FROM written_score_reviews AS review
                   WHERE review.attempt_id=attempt.attempt_id
                     AND review.case_id=$1 AND review.status='FINAL' AND review.decision='PASS'
                )
                OR EXISTS (
                  SELECT 1 FROM assurance_case_timeline_events AS event
                   WHERE event.case_id=$1 AND event.tenant_id=$3
                     AND event.event_type='assessment_auto_scored_pass'
                     AND event.occurred_at >= attempt.submitted_at
                )
              )
         ) AS eligible`,
        [caseId, row.worker_account_id, tenantId]
      );
      if (!passing.rows[0]?.eligible) {
        throw new Error("Required assessment has no completed passing result.");
      }
    }

    if (row.interview_required) {
      const passing = await client.query<{ eligible: boolean }>(
        `SELECT EXISTS(
           SELECT 1
             FROM interview_requests AS request
             JOIN interview_console_drafts AS draft
               ON draft.tenant_id=request.tenant_id
              AND draft.interview_request_id=request.interview_request_id
            WHERE request.tenant_id=$1 AND request.case_id=$2
              AND request.interview_request_id=$3
              AND request.status='COMPLETED'
              AND draft.submitted=TRUE
              AND draft.recommendation IN ('PASS','CONDITIONAL_PASS')
         ) AS eligible`,
        [tenantId, caseId, row.interview_reference]
      );
      if (!passing.rows[0]?.eligible) {
        throw new Error("Required interview has no completed passing recommendation.");
      }
    }
  }

  async saveDecisionAndProgressCase(
    decision: DecisionRecord,
    actorAccountId: string,
    acceptedRenewalAppealId?: string
  ): Promise<void> {
    if (!actorAccountId.trim()) throw new Error("Decision actor is required.");
    const client = await this.clientPromise;
    await client.transaction(async (transaction) => {
      const current = await transaction.query<{ case_status: string }>(
        `SELECT case_status
           FROM assurance_cases
          WHERE tenant_id=$1 AND case_id=$2
          FOR UPDATE`,
        [decision.tenantId, decision.caseId]
      );
      if (current.rows[0]?.case_status !== "Decision pending") {
        throw new Error("Assurance Case is not ready for a final decision.");
      }
      await this.assertPositiveDecisionPrerequisites(transaction, decision, actorAccountId, acceptedRenewalAppealId);
      await this.saveDecisionWithClient(transaction, decision);
      await this.applyDecisionToAssuranceCase(transaction, {
        tenantId: decision.tenantId,
        caseId: decision.caseId,
        decisionId: decision.decisionId,
        state: decision.state,
        actorAccountId,
        eventType: "decision_recorded",
        expectedCaseStatus: "Decision pending"
      });
      await this.issueCredentialForPositiveDecision(transaction, decision, actorAccountId);
    });
  }

  async applyOverrideState(override: ManualDecisionOverride): Promise<void> {
    const client = await this.clientPromise;
    await this.applyOverrideStateWithClient(client, override);
  }

  async saveOverride(override: ManualDecisionOverride): Promise<void> {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO platform_decision_overrides
       (override_id, decision_id, tenant_id, previous_state, new_state, reason, evidence_reference, actor_reference, confirmed, created_at, mfa_verified_at, notification_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        override.overrideId,
        override.decisionId,
        override.tenantId,
        override.previousState,
        override.newState,
        override.reason,
        override.evidenceReference,
        override.actorReference,
        override.confirmed,
        override.createdAt,
        override.mfaVerifiedAt,
        override.notificationRequired
      ]
    );
  }

  async persistOverride(override: ManualDecisionOverride): Promise<void> {
    const client = await this.clientPromise;
    await client.transaction(async (transaction) => {
      const decision = await transaction.query<{ case_id: string }>(
        `SELECT case_id
           FROM platform_decisions
          WHERE decision_id=$1 AND tenant_id=$2 AND state=$3
          FOR UPDATE`,
        [override.decisionId, override.tenantId, override.previousState]
      );
      const caseId = decision.rows[0]?.case_id;
      if (!caseId) {
        throw new Error("Decision override target could not be resolved within the tenant boundary.");
      }
      const previous = await new DecisionRepository(Promise.resolve(transaction)).findDecision(override.decisionId,override.tenantId);
      if (!previous) throw new Error("Decision override cannot verify the original source.");
      await this.assertPositiveDecisionPrerequisites(
        transaction,{...previous,state:override.newState},override.actorReference
      );
      await this.applyOverrideStateWithClient(transaction, override);
      await this.saveOverrideWithClient(transaction, override);
      await this.applyDecisionToAssuranceCase(transaction, {
        tenantId: override.tenantId,
        caseId,
        decisionId: override.decisionId,
        state: override.newState,
        actorAccountId: override.actorReference,
        eventType: "decision_override_applied",
        expectedCaseStatus: assuranceProjection(override.previousState).caseStatus
      });
      const scoped = new DecisionRepository(Promise.resolve(transaction));
      const currentDecision = await scoped.findDecision(override.decisionId, override.tenantId);
      if (!currentDecision) throw new Error("Decision override could not resolve its current record.");
      await this.issueCredentialForPositiveDecision(transaction, {
        ...currentDecision,
        reason: { code: "manual_override", explanation: override.reason }
      }, override.actorReference);
      const linked = await transaction.query<{ credential_reference: string | null }>(
        "SELECT credential_reference FROM assurance_cases WHERE tenant_id=$1 AND case_id=$2",
        [override.tenantId, caseId]
      );
      const credentialId = linked.rows[0]?.credential_reference;
      if (credentialId) {
        const credentials = new CredentialIssuanceRepository(Promise.resolve(transaction));
        const credential = await credentials.findPublic(credentialId);
        if (!credential) throw new Error("Decision credential binding is unavailable.");
        const status = override.newState === "APPROVED" || override.newState === "CONDITIONALLY_APPROVED"
          ? "valid" : override.newState === "EXPIRED" ? "expired"
          : override.newState === "REVOKED" || override.newState === "REJECTED" ? "revoked" : "suspended";
        if (credential.status === "revoked" && status !== "revoked") {
          throw new Error("A revoked credential requires controlled replacement before approval.");
        }
        if (credential.status !== status && !await credentials.updateStatus(credentialId, status, credential.version, credential.status)) {
          throw new Error("Decision credential status changed concurrently.");
        }
        const records = new LivingRecordRepository(Promise.resolve(transaction));
        for (const record of await records.findByCredential(credentialId)) {
          const previous = record.versions.at(-1)!;
          await records.replaceCompetencyRecord(credential.workerId, appendLivingCompetencyVersion(record, {
            ...previous, status: override.newState === "REASSESSMENT_REQUIRED" ? "reassessment_required" : status, effectiveAt: override.createdAt,
            conditions: override.newState === "CONDITIONALLY_APPROVED" ? [override.reason] : [],
            reassessment: { required: override.newState === "REASSESSMENT_REQUIRED", dueAt: null,
              reason: override.newState === "REASSESSMENT_REQUIRED" ? override.reason : null }
          }));
        }
      }

    });
  }

  private async saveOverrideWithClient(client: Awaited<typeof this.clientPromise>, override: ManualDecisionOverride): Promise<void> {
    await client.query(
      `INSERT INTO platform_decision_overrides
       (override_id, decision_id, tenant_id, previous_state, new_state, reason, evidence_reference, actor_reference, confirmed, created_at, mfa_verified_at, notification_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        override.overrideId,
        override.decisionId,
        override.tenantId,
        override.previousState,
        override.newState,
        override.reason,
        override.evidenceReference,
        override.actorReference,
        override.confirmed,
        override.createdAt,
        override.mfaVerifiedAt,
        override.notificationRequired
      ]
    );
  }

  async findDecision(decisionId: string, tenantId: string): Promise<DecisionRecord | null> {
    const client = await this.clientPromise;
    const result = await client.query<DecisionRecord>(
      `SELECT decision_id as "decisionId", case_id as "caseId", tenant_id as "tenantId", state,
              reason_code as "reasonCode", explanation, rule_version as "ruleVersion",
              input_references as "inputReferences", created_at as "createdAt"
       FROM platform_decisions
       WHERE decision_id=$1 AND tenant_id=$2`,
      [decisionId, tenantId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      decisionId: row.decisionId,
      tenantId: row.tenantId,
      caseId: row.caseId,
      state: row.state,
      reason: {
        code: (row as unknown as { reasonCode: string }).reasonCode,
        explanation: (row as unknown as { explanation: string }).explanation
      },
      ruleVersion: row.ruleVersion,
      inputReferences: row.inputReferences,
      createdAt: row.createdAt
    };
  }

  async listByCase(caseId: string, tenantId: string): Promise<readonly DecisionRecord[]> {
    const client = await this.clientPromise;
    const result = await client.query<DecisionRecord>(
      `SELECT decision_id as "decisionId", case_id as "caseId", state,
              reason_code as "reasonCode", explanation, rule_version as "ruleVersion",
              input_references as "inputReferences", created_at as "createdAt"
       FROM platform_decisions WHERE case_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`,
      [caseId, tenantId]
    );
    return result.rows.map((row) => ({
      decisionId: row.decisionId,
      tenantId,
      caseId: row.caseId,
      state: row.state,
      reason: { code: (row as unknown as { reasonCode: string }).reasonCode, explanation: (row as unknown as { explanation: string }).explanation },
      ruleVersion: row.ruleVersion,
      inputReferences: row.inputReferences,
      createdAt: row.createdAt
    }));
  }

  async listOverrides(decisionId: string, tenantId: string): Promise<readonly ManualDecisionOverride[]> {
    const client = await this.clientPromise;
    const result = await client.query<ManualDecisionOverride>(
      `SELECT override_id as "overrideId", decision_id as "decisionId",
              previous_state as "previousState", new_state as "newState",
              reason, evidence_reference as "evidenceReference",
              confirmed, actor_reference as "actorReference", created_at as "createdAt"
              , mfa_verified_at as "mfaVerifiedAt", notification_required as "notificationRequired"
       FROM platform_decision_overrides
       WHERE decision_id=$1 AND tenant_id=$2
       ORDER BY created_at DESC`,
      [decisionId, tenantId]
    );
    return result.rows;
  }
}