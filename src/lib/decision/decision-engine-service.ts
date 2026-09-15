import { createDecision, toDecisionAuditEvent, type DecisionRecord, type ManualDecisionOverride } from "./decision-engine-domain";
import type { AuditRepository } from "../audit/audit-repository";
import { bindTrustedSystemAuditActor } from "../audit/audit-domain";
import { getAuditRepository } from "../audit/audit-repository";
import { DecisionRepository } from "./decision-engine-repository";

export class DecisionEngineService {
  constructor(private readonly auditRepository = getAuditRepository(), private readonly decisionRepository = new DecisionRepository()) {}

  async createAndRecord(input: {
    caseId: string;
    state: unknown;
    reasonCode: string;
    explanation: string;
    ruleVersion: string;
    inputReferences: string[];
  }): Promise<DecisionRecord> {
    const decision = createDecision({ ...input, createdAt: new Date().toISOString() });
    await this.recordCreated(decision);
    return decision;
  }

  async recordCreated(decision: DecisionRecord): Promise<void> {
    await this.decisionRepository.saveDecision(decision);
    const event = toDecisionAuditEvent(decision);
    await this.auditRepository.append(bindTrustedSystemAuditActor("outbox-worker"), {
      action: event.type,
      outcome: "succeeded",
      target: { type: "decision", reference: event.decisionId },
      metadata: {
        caseId: event.caseId,
        outcome: event.outcome,
        ruleVersion: event.ruleVersion
      }
    });
  }

  async recordOverride(override: ManualDecisionOverride): Promise<void> {
    await this.decisionRepository.saveOverride(override);
    await this.auditRepository.append(bindTrustedSystemAuditActor("outbox-worker"), {
      action: "decision.override.created",
      outcome: "succeeded",
      target: { type: "decision", reference: override.decisionId },
      metadata: {
        overrideId: override.overrideId,
        previousState: override.previousState,
        newState: override.newState,
        actorReference: override.actorReference
      }
    });
  }
}
