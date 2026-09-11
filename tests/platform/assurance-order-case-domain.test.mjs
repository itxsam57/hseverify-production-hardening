import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const paths = Object.freeze({
  domain: "src/lib/assurance/assurance-order-domain.ts",
  service: "src/lib/assurance/assurance-order-service.ts",
  repository: "src/lib/assurance/assurance-order-repository.ts",
  actions: "src/app/company/(portal)/assurance-orders/actions.ts",
  actionCentre: "src/lib/assurance/assurance-action-centre-service.ts"
});

function source(path) {
  assert.equal(existsSync(resolve(path)), true, `${path} must exist`);
  return readFileSync(resolve(path), "utf8");
}

test("M2.01 fixes the canonical Assurance Order, Case and Action Centre vocabularies", () => {
  const domain = source(paths.domain);

  for (const status of [
    "DRAFT",
    "VALIDATION_FAILED",
    "READY",
    "SUBMITTED",
    "PARTIALLY_FUNDED",
    "ACTIVE",
    "COMPLETED",
    "CANCELLED",
    "CLOSED"
  ]) assert.match(domain, new RegExp(`\\b${status}\\b`));

  for (const status of [
    "Created",
    "Awaiting worker acceptance",
    "Identity pending",
    "Evidence pending",
    "Funding pending",
    "Assessment pending",
    "Assessment in progress",
    "Review pending",
    "Interview pending",
    "Decision pending",
    "Approved",
    "Conditionally approved",
    "Reassessment required",
    "Rejected",
    "Suspended",
    "Closed"
  ]) assert.ok(domain.includes(status), status);

  for (const owner of [
    "worker",
    "company",
    "reviewer",
    "assessor",
    "admin",
    "payment",
    "background_job"
  ]) assert.match(domain, new RegExp(`\"${owner}\"`));

  for (const severity of ["info", "warning", "critical"])
    assert.match(domain, new RegExp(`\"${severity}\"`));

  assert.ok(!/\bprocessing\b/i.test(domain), "M2.01 cannot expose a vague processing state");
});

test("M2.01 derives Company order authority from existing tenant permissions and never from browser ownership fields", () => {
  const domain = source(paths.domain);
  const service = source(paths.service);
  const actions = source(paths.actions);

  assert.match(domain, /company\.orders\.read/);
  assert.match(domain, /company\.orders\.manage/);
  assert.match(service, /TenantPermissionPrincipal|deriveTrustedTenantScope|company\.orders\.manage/);
  assert.match(actions, /requireCurrentTenantPermission\(["']company\.orders\.manage["']\)/);

  for (const forbiddenField of [
    "tenantId",
    "membershipId",
    "accountId",
    "actorAccountId",
    "createdByMembershipId"
  ]) {
    assert.ok(
      !new RegExp(`formData\\.get\\([\"']${forbiddenField}[\"']\\)`).test(actions),
      `${forbiddenField} cannot be browser authority`
    );
  }
});

test("M2.01 represents the canonical order fields without implementing later engines", () => {
  const domain = source(paths.domain);
  const service = source(paths.service);
  const actionCentre = source(paths.actionCentre);

  for (const marker of [
    "orderName",
    "orderReference",
    "siteId",
    "departmentId",
    "requestedIdentityChecks",
    "requestedEvidenceChecks",
    "assessmentFrameworkReferences",
    "interviewRequired",
    "credentialTarget",
    "deadline",
    "effectivePolicyReference",
    "companyNotes",
    "purchaseOrderReference",
    "fundingMethod"
  ]) assert.ok(domain.includes(marker), marker);

  for (const marker of [
    "severity",
    "reason",
    "dueAt",
    "owner",
    "allowedAction",
    "deepLink"
  ]) assert.ok(actionCentre.includes(marker), marker);

  assert.ok(!/approveReviewer|rejectEvidence|requestChangesFromReviewer/i.test(service));
  assert.ok(!/publishQuestion|generateAssessmentForm|scoreWrittenAnswer|issueCredential|createLivingRecord/i.test(service));
});
