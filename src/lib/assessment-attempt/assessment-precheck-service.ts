import "server-only";

import { createIdentifier } from "@/lib/auth/auth-domain";
import { bindTrustedAuditActor } from "@/lib/audit/audit-domain";
import { DatabaseAuditRepository } from "@/lib/audit/audit-repository";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { AssessmentCatalogueEligibilityService } from "@/lib/assessment-catalogue/assessment-catalogue-eligibility-service";
import {
  getAssessmentDeliverySettingsService,
  type AssessmentDeliverySettingsService
} from "@/lib/assessment-generation/assessment-delivery-settings-service";
import type { AssessmentDeliverySettings } from "@/lib/assessment-generation/assessment-delivery-settings";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import type { AssessmentAccessContext } from "@/lib/assessment-attempt/assessment-device-cookie";
import { CaseAccommodationService, type CaseAccommodationView } from "@/lib/privacy/case-accommodation-service";
import { ConsentRecordService } from "@/lib/privacy/consent-record-service";

export type AssessmentPrecheckInput = Readonly<{
  caseId: string;
  catalogueVersionId: string;
  supportedBrowser: boolean;
  connectionOk: boolean;
  cameraOk: boolean;
  microphoneOk: boolean;
  screenShareOk: boolean;
  fullscreenCapable: boolean;
  identityReconfirmed: boolean;
  environmentDeclared: boolean;
  monitoringConsented: boolean;
  diagnostics?: Readonly<Record<string, unknown>>;
}>;

export type AssessmentPrecheckRequirements = Readonly<{
  caseId: string;
  catalogueVersionId: string;
  blueprintVersionId: string;
  title: string;
  delivery: AssessmentDeliverySettings;
  accommodation: CaseAccommodationView;
}>;

export class AssessmentPrecheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentPrecheckError";
  }
}

function safeDiagnostics(value: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  if (!value) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_.-]{1,60}$/.test(key)) continue;
    if (typeof item === "string") result[key] = item.slice(0, 240);
    else if (typeof item === "boolean" || typeof item === "number") result[key] = item;
  }
  return result;
}

export class AssessmentPrecheckService {
  constructor(
    private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient(),
    private readonly settings: AssessmentDeliverySettingsService = getAssessmentDeliverySettingsService()
  ) {}

  async requirements(
    principal: AuthorizationPrincipal,
    caseId: string,
    catalogueVersionId: string,
    now = new Date()
  ): Promise<AssessmentPrecheckRequirements> {
    if (principal.activeRole !== "worker" || principal.accountStatus !== "active") {
      throw new AssessmentPrecheckError("Worker access is required.");
    }
    const database = await this.databasePromise;
    const available = await new AssessmentCatalogueEligibilityService(database)
      .findAvailableForCase(principal, caseId.trim(), now);
    const selected = available.find((entry) => entry.catalogueVersionId === catalogueVersionId.trim());
    if (!selected) throw new AssessmentPrecheckError("This assessment is no longer available.");
    const accommodation = await new CaseAccommodationService(Promise.resolve(database))
      .resolveForWorker(selected.caseId, principal.accountId);
    return Object.freeze({
      caseId: selected.caseId,
      catalogueVersionId: selected.catalogueVersionId,
      blueprintVersionId: selected.blueprintVersionId,
      title: selected.title,
      delivery: await this.settings.get(selected.blueprintVersionId),
      accommodation
    });
  }

  async recordPassed(
    principal: AuthorizationPrincipal,
    access: AssessmentAccessContext,
    input: AssessmentPrecheckInput,
    now = new Date()
  ): Promise<Readonly<{ precheckId: string; blueprintVersionId: string }>> {
    const requirements = await this.requirements(
      principal,
      input.caseId,
      input.catalogueVersionId,
      now
    );
    const delivery = requirements.delivery;

    const missing: string[] = [];
    if (!input.supportedBrowser) missing.push("supported browser");
    if (!input.connectionOk) missing.push("connection");
    if (delivery.requireCamera && !input.cameraOk) missing.push("camera permission");
    if (delivery.requireMicrophone && !input.microphoneOk) missing.push("microphone permission");
    if (delivery.requireScreenShare && !input.screenShareOk) missing.push("screen-share permission");
    if (delivery.requireFullscreen && !input.fullscreenCapable) missing.push("fullscreen capability");
    if (!input.identityReconfirmed) missing.push("identity reconfirmation");
    if (delivery.requireEnvironmentDeclaration && !input.environmentDeclared) missing.push("environment declaration");
    if (delivery.requireMonitoringConsent && !input.monitoringConsented) missing.push("monitoring consent");
    if (missing.length > 0) {
      throw new AssessmentPrecheckError(
        `Complete the required pre-assessment checks: ${missing.join(", ")}.`
      );
    }

    const database = await this.databasePromise;
    return database.transaction(async (tx) => {
      const competing = await tx.query<{ attempt_id: string }>(
        `SELECT attempts.attempt_id
           FROM assessment_attempts AS attempts
           LEFT JOIN assessment_attempt_bindings AS bindings ON bindings.attempt_id=attempts.attempt_id
          WHERE attempts.worker_account_id=$1
            AND attempts.status IN ('IN_PROGRESS','INTERRUPTED')
            AND attempts.case_id<>$2
            AND (bindings.device_token_hash IS NULL OR bindings.device_token_hash<>$3)
          LIMIT 1`,
        [principal.accountId, input.caseId, access.deviceTokenHash]
      );
      if (competing.rows[0]) {
        throw new AssessmentPrecheckError(
          "Another active assessment is bound to a different device or session. Exit or recover that assessment first."
        );
      }

      const precheckId = createIdentifier("assessment_precheck");
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      await tx.query(
        `INSERT INTO assessment_precheck_records(
           precheck_id,case_id,worker_account_id,catalogue_version_id,blueprint_version_id,auth_session_id,
           device_token_hash,supported_browser,connection_ok,camera_ok,microphone_ok,
           screen_share_ok,fullscreen_capable,identity_reconfirmed,environment_declared,
           monitoring_consented,passed,diagnostics_json,created_at,expires_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,$17::jsonb,$18,$19)`,
        [
          precheckId,
          input.caseId,
          principal.accountId,
          input.catalogueVersionId,
          requirements.blueprintVersionId,
          principal.sessionId,
          access.deviceTokenHash,
          input.supportedBrowser,
          input.connectionOk,
          input.cameraOk,
          input.microphoneOk,
          input.screenShareOk,
          input.fullscreenCapable,
          input.identityReconfirmed,
          input.environmentDeclared,
          input.monitoringConsented,
          JSON.stringify(safeDiagnostics(input.diagnostics)),
          now.toISOString(),
          expiresAt
        ]
      );
      if (delivery.requireMonitoringConsent && input.monitoringConsented) {
        const consent = new ConsentRecordService(Promise.resolve(tx));
        const common = {
          workerId: principal.accountId,
          actorAccountId: principal.accountId,
          caseId: input.caseId,
          withdrawalRule: "NOT_WITHDRAWABLE_WHILE_REQUIRED" as const,
          now,
          metadata: {
            precheckId,
            blueprintVersionId: requirements.blueprintVersionId,
            retentionDays: delivery.recordingRetentionDays
          }
        };
        if (delivery.requireCamera) {
          await consent.grant({
            ...common,
            consentType: "webcam",
            purpose: "Assessment webcam use and integrity monitoring for the assigned Assurance Case."
          });
        }
        if (delivery.requireMicrophone) {
          await consent.grant({
            ...common,
            consentType: "microphone",
            purpose: "Assessment microphone use and integrity monitoring for the assigned Assurance Case."
          });
        }
        if (delivery.recordScreen) {
          await consent.grant({
            ...common,
            consentType: "screen_recording",
            purpose: "Assessment screen recording for integrity review under the locked delivery policy."
          });
        }
        if (delivery.recordCamera || delivery.recordMicrophone || delivery.recordScreen) {
          await consent.grant({
            ...common,
            consentType: "retention_notice",
            purpose: "Assessment recording retention notice acknowledged for the locked delivery policy."
          });
        }
      }
      await new DatabaseAuditRepository(Promise.resolve(tx)).append(
        bindTrustedAuditActor(principal),
        {
          action: "assessment.precheck.completed",
          outcome: "succeeded",
          target: { type: "resource", reference: precheckId },
          metadata: {
            caseId: input.caseId,
            catalogueVersionId: input.catalogueVersionId,
            blueprintVersionId: requirements.blueprintVersionId,
            cameraRequired: delivery.requireCamera,
            microphoneRequired: delivery.requireMicrophone,
            screenShareRequired: delivery.requireScreenShare
          }
        }
      );
      return Object.freeze({ precheckId, blueprintVersionId: requirements.blueprintVersionId });
    });
  }
}

let service: AssessmentPrecheckService | null = null;
export function getAssessmentPrecheckService(): AssessmentPrecheckService {
  service ??= new AssessmentPrecheckService();
  return service;
}