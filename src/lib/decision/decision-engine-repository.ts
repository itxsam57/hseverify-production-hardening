import "server-only";

import { getDatabaseClient } from "../database/database";
import type { DecisionRecord, ManualDecisionOverride } from "./decision-engine-domain";

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

  async saveDecision(decision: DecisionRecord): Promise<void> {
    const client = await this.clientPromise;
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
      await this.applyOverrideStateWithClient(transaction, override);
      await this.saveOverrideWithClient(transaction, override);
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
