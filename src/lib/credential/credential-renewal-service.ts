import "server-only";
import { createIdentifier } from "../auth/auth-domain";
import { AssuranceOrderRepository } from "../assurance/assurance-order-repository";
import type { DatabaseClient } from "../database/database";
import { createDecision } from "../decision/decision-engine-domain";
import { DecisionRepository } from "../decision/decision-engine-repository";
import { normalizeCredentialValidityPolicyFields } from "./credential-validity-domain";
import { credentialAuthentication } from "./credential-issuance-domain";
import { CredentialIssuanceRepository } from "./credential-issuance-repository";
import type { CredentialAppeal } from "./credential-appeals-domain";
import { pinAssuranceCasePolicySnapshot } from "../policy/effective-policy-service";

export class CredentialRenewalInputError extends Error {
  constructor(message:string) { super(message); this.name = "CredentialRenewalInputError"; }
}

export async function issueAppealRenewal(database: DatabaseClient, appeal: CredentialAppeal, signingSecret?: string) {
  if (appeal.status !== "accepted" || appeal.outcomeAction !== "renew" || !appeal.reviewedAt ||
      !appeal.reviewerAccountId || !appeal.reviewReason) throw new CredentialRenewalInputError("A reasoned accepted renewal review is required.");
  const credentials = new CredentialIssuanceRepository(Promise.resolve(database));
  const locked = await database.query("SELECT credential_id FROM credential_issuances WHERE credential_id=$1 AND worker_id=$2 FOR UPDATE",
    [appeal.credentialId, appeal.workerId]);
  const original = locked.rows[0] ? await credentials.findPublic(appeal.credentialId) : null;
  if (!original || original.workerId !== appeal.workerId || original.status === "revoked") throw new CredentialRenewalInputError("Appealed credential ownership or lifecycle is invalid.");
  const environment = signingSecret ? null : (await import("../config/server-environment")).getServerEnvironment();
  const currentKey = signingSecret ?? environment?.credentialSigningSecret;
  if (!currentKey || credentialAuthentication(original,[currentKey,...(environment?.credentialSigningPreviousSecrets ?? [])]) !== "authenticated")
    throw new CredentialRenewalInputError("Renewal original issuance could not be authenticated.");
  if (new Date(appeal.reviewedAt).getTime() < new Date(original.issuedAt).getTime()) throw new CredentialRenewalInputError("Renewal review cannot precede original issuance.");
  if ((await database.query("SELECT 1 FROM credential_replacements WHERE old_credential_id=$1 OR appeal_id=$2",[appeal.credentialId,appeal.appealId])).rows[0])
    throw new CredentialRenewalInputError("Credential replacement conflict.");
  const source = await database.query<{
    case_id:string;tenant_id:string;order_id:string;decision_reference:string;worker_account_id:string;worker_link_id:string;
    state:string;framework_reference:string;policy_reference:string;
  }>(`SELECT cases.case_id,cases.tenant_id,cases.order_id,cases.decision_reference,cases.worker_account_id,cases.worker_link_id,
              decision.state,framework.framework_reference,pack.policy_reference
       FROM assurance_cases cases JOIN platform_decisions decision
         ON decision.decision_id=cases.decision_reference AND decision.tenant_id=cases.tenant_id
       JOIN assurance_case_policy_snapshots snapshot ON snapshot.case_id=cases.case_id AND snapshot.tenant_id=cases.tenant_id
       JOIN assurance_policy_packs pack ON pack.policy_id=snapshot.policy_id AND pack.framework_id=snapshot.framework_id
       JOIN assurance_frameworks framework ON framework.framework_id=snapshot.framework_id
       WHERE cases.credential_reference=$1 AND cases.permanent_worker_id=$2 FOR UPDATE OF cases`,
    [original.credentialId,original.workerId]);
  if (source.rows.length !== 1) throw new CredentialRenewalInputError("Renewal requires the original case and configured policy provenance.");
  if (source.rows[0].worker_account_id === appeal.reviewerAccountId)
    throw new CredentialRenewalInputError("Independent review cannot accept its own credential renewal.");
  if (source.rows[0].state === "REVOKED") throw new CredentialRenewalInputError("A revoked decision requires controlled replacement review.");
  const previous = source.rows[0], orders = new AssuranceOrderRepository(database);
  const oldOrder = await orders.lockOrder(previous.tenant_id,previous.order_id);
  if (!oldOrder) throw new CredentialRenewalInputError("Renewal source order is outside the tenant boundary.");
  const orderId = createIdentifier("assurance_order"), caseId = createIdentifier("assurance_case");
  await orders.insertDraft({orderId,tenantId:previous.tenant_id,membershipId:oldOrder.createdByMembershipId,now:appeal.reviewedAt,draft:{
    orderName:"Credential renewal",orderReference:"RENEWAL-"+appeal.appealId,siteId:oldOrder.siteId,departmentId:oldOrder.departmentId,
    requestedIdentityChecks:oldOrder.requestedIdentityChecks,requestedEvidenceChecks:oldOrder.requestedEvidenceChecks,
    assessmentFrameworkReferences:[previous.framework_reference],interviewRequired:oldOrder.interviewRequired,credentialTarget:original.qualification,
    deadline:null,effectivePolicyReference:previous.policy_reference,companyNotes:appeal.reviewReason,purchaseOrderReference:null
  }});
  const sourceTarget = await database.query<{funding_method:"company"|"worker"}>("SELECT funding_method FROM assurance_order_workers WHERE tenant_id=$1 AND order_id=$2 AND worker_account_id=$3",[previous.tenant_id,previous.order_id,previous.worker_account_id]);
  if (sourceTarget.rows.length !== 1) throw new CredentialRenewalInputError("Renewal target provenance is invalid.");
  const target = await orders.insertTarget({targetId:createIdentifier("assurance_target"),orderId,tenantId:previous.tenant_id,
    workerLinkId:previous.worker_link_id,workerAccountId:previous.worker_account_id,permanentWorkerId:original.workerId,
    siteId:oldOrder.siteId,departmentId:oldOrder.departmentId,fundingMethod:sourceTarget.rows[0].funding_method,now:appeal.reviewedAt});
  const created = await orders.insertCase({caseId,target,status:"Decision pending",owner:"admin",
    nextAction:"Record the independently accepted renewal decision.",now:appeal.reviewedAt});
  if (!created) throw new CredentialRenewalInputError("Renewal case conflict.");
  // No payment is requested or created: this order carries controlled review provenance only.
  await database.query("UPDATE assurance_order_workers SET target_status='submitted' WHERE target_id=$1 AND tenant_id=$2",
    [target.targetId,previous.tenant_id]);
  await database.query("UPDATE assurance_orders SET order_status='SUBMITTED',submitted_at=$2 WHERE order_id=$1 AND tenant_id=$3",
    [orderId,appeal.reviewedAt,previous.tenant_id]);
  const pin = await pinAssuranceCasePolicySnapshot(database,{tenantId:previous.tenant_id,caseId,
    frameworkReferences:[previous.framework_reference],policyReference:previous.policy_reference,
    referenceTime:new Date(appeal.reviewedAt),actorAccountId:appeal.reviewerAccountId});
  if (!pin || normalizeCredentialValidityPolicyFields(pin.effectiveValue).mode === "unspecified")
    throw new CredentialRenewalInputError("Renewal validity is not configured in the applicable policy.");
  const decision = createDecision({tenantId:previous.tenant_id,caseId,
    state:previous.state === "CONDITIONALLY_APPROVED" ? "CONDITIONALLY_APPROVED" : "APPROVED",
    reasonCode:"accepted_appeal_renewal",explanation:appeal.reviewReason,ruleVersion:pin.globalPolicyVersionId,
    inputReferences:[appeal.appealId,original.credentialId,previous.case_id,previous.decision_reference,...appeal.evidence],
    createdAt:appeal.reviewedAt});
  await new DecisionRepository(Promise.resolve(database),currentKey).saveDecisionAndProgressCase(decision,appeal.reviewerAccountId);
  const linked = await database.query<{credential_reference:string}>(
    "SELECT credential_reference FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2",[caseId,previous.tenant_id]);
  const replacement = await credentials.findPublic(linked.rows[0]?.credential_reference);
  if (!replacement || replacement.workerId !== original.workerId) throw new CredentialRenewalInputError("Renewal issuance ownership is invalid.");
  const replacementId = createIdentifier("credential_replacement");
  await database.query(`INSERT INTO credential_replacements(
    replacement_id,appeal_id,tenant_id,worker_id,old_case_id,new_case_id,old_decision_id,new_decision_id,
    old_credential_id,new_credential_id,policy_snapshot_id,reason,actor_account_id,replaced_at
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [replacementId,appeal.appealId,previous.tenant_id,original.workerId,previous.case_id,caseId,previous.decision_reference,
   decision.decisionId,original.credentialId,replacement.credentialId,pin.snapshotId,appeal.reviewReason,appeal.reviewerAccountId,appeal.reviewedAt]);
  const retained = await credentials.updateStatus(original.credentialId,"revoked",original.version,original.status,appeal.reviewedAt);
  if (!retained) throw new CredentialRenewalInputError("Original credential replacement conflict.");
  return Object.freeze({replacementId,credentialId:replacement.credentialId,caseId,decisionId:decision.decisionId,policySnapshotId:pin.snapshotId});
}
