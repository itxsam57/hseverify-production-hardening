import { requireRecentSessionMfa } from "../auth/recent-mfa-service";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { createDecision, toDecisionAuditEvent, type DecisionRecord, type ManualDecisionOverride } from "./decision-engine-domain";
import { bindTrustedSystemAuditActor } from "../audit/audit-domain";
import { getAuditRepository } from "../audit/audit-repository";
import { DecisionRepository } from "./decision-engine-repository";

export class DecisionEngineService {
  constructor(private readonly auditRepository = getAuditRepository(), private readonly decisionRepository = new DecisionRepository()) {}

  async createAndRecord(input: {
    tenantId: string;
    caseId: string;
    state: unknown;
    reasonCode: string;
    explanation: string;
    ruleVersion: string;
    inputReferences: string[];
    actorAccountId?: string;
  }): Promise<DecisionRecord> {
    const decision = createDecision({ ...input, createdAt: new Date().toISOString() });
    if (
      input.actorAccountId &&
      "saveDecisionAndProgressCase" in this.decisionRepository &&
      typeof (this.decisionRepository as DecisionRepository & {
        saveDecisionAndProgressCase?: unknown;
      }).saveDecisionAndProgressCase === "function"
    ) {
      await this.decisionRepository.saveDecisionAndProgressCase(
        decision,
        input.actorAccountId
      );
      await this.recordAudit(decision);
      return decision;
    }
    await this.recordCreated(decision);
    return decision;
  }

  private async recordAudit(decision: DecisionRecord): Promise<void> {
    const event = toDecisionAuditEvent(decision);
    await this.auditRepository.append(bindTrustedSystemAuditActor("outbox-worker"), {
      action: event.type,
      outcome: "succeeded",
      target: { type: "resource", reference: event.decisionId },
      metadata: {
        caseId: event.caseId,
        outcome: event.outcome,
        reasonCode: event.reasonCode,
        explanation: event.explanation,
        ruleVersion: event.ruleVersion,
        inputReferences: event.inputReferences
      }
    });
  }

  async recordCreated(decision: DecisionRecord): Promise<void> {
    await this.decisionRepository.saveDecision(decision);
    await this.recordAudit(decision);
  }

  async recordOverride(override: ManualDecisionOverride, principal: AuthorizationPrincipal): Promise<void> {
    const mfaVerifiedAt = await requireRecentSessionMfa(principal);
    if (principal.accountId !== override.actorReference) throw new Error("Decision override actor does not match the authenticated account.");
    override = { ...override, mfaVerifiedAt };
    const decision = await this.decisionRepository.findDecision(override.decisionId, override.tenantId);
    if (!decision) {
      throw new Error("Decision override target is outside the tenant boundary or does not exist.");
    }
    if (decision.state !== override.previousState) {
      throw new Error("Decision override previous state does not match current decision state.");
    }
    if (override.actorReference === decision.decisionId) {
      throw new Error("Decision override actor cannot be the decision reference.");
    }
    await this.decisionRepository.persistOverride(override);
    await this.auditRepository.append(bindTrustedSystemAuditActor("outbox-worker"), {
      action: "decision.override.created",
      outcome: "succeeded",
      target: { type: "resource", reference: override.decisionId },
      metadata: {
        overrideId: override.overrideId,
        previousState: override.previousState,
        newState: override.newState,
        actorReference: override.actorReference
      }
    });
  }
}