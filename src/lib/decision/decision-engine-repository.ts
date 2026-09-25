import "server-only";

import { createIdentifier } from "../auth/auth-domain";
import { getDatabaseClient } from "../database/database";
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
  constructor(private readonly clientPromise = getDatabaseClient()) {}

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

    const projection = assuranceProjection(input.state);
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
          `/company/assurance-orders/${assuranceCase.order_id}#${input.caseId}`,
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

  async saveDecisionAndProgressCase(
    decision: DecisionRecord,
    actorAccountId: string
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