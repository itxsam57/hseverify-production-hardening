import "server-only";

import { getDatabaseClient } from "../database/database";
import type { DecisionRecord, ManualDecisionOverride } from "./decision-engine-domain";

export class DecisionRepository {
  constructor(private readonly clientPromise = getDatabaseClient()) {}

  async saveDecision(decision: DecisionRecord): Promise<void> {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO platform_decisions
       (decision_id, case_id, state, reason_code, explanation, rule_version, input_references, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        decision.decisionId,
        decision.caseId,
        decision.state,
        decision.reason.code,
        decision.reason.explanation,
        decision.ruleVersion,
        JSON.stringify(decision.inputReferences),
        decision.createdAt
      ]
    );
  }

  async saveOverride(override: ManualDecisionOverride): Promise<void> {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO platform_decision_overrides
       (override_id, decision_id, previous_state, new_state, reason, evidence_reference, actor_reference, confirmed, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        override.overrideId,
        override.decisionId,
        override.previousState,
        override.newState,
        override.reason,
        override.evidenceReference,
        override.actorReference,
        override.confirmed,
        override.createdAt
      ]
    );
  }

  async listByCase(caseId: string): Promise<readonly DecisionRecord[]> {
    const client = await this.clientPromise;
    const result = await client.query<DecisionRecord>(
      `SELECT decision_id as "decisionId", case_id as "caseId", state,
              reason_code as "reasonCode", explanation, rule_version as "ruleVersion",
              input_references as "inputReferences", created_at as "createdAt"
       FROM platform_decisions WHERE case_id=$1 ORDER BY created_at DESC`,
      [caseId]
    );
    return result.rows.map((row) => ({
      decisionId: row.decisionId,
      caseId: row.caseId,
      state: row.state,
      reason: { code: (row as unknown as { reasonCode: string }).reasonCode, explanation: (row as unknown as { explanation: string }).explanation },
      ruleVersion: row.ruleVersion,
      inputReferences: row.inputReferences,
      createdAt: row.createdAt
    }));
  }
}
