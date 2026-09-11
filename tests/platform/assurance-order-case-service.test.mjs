import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const files = Object.freeze({
  service: "src/lib/assurance/assurance-order-service.ts",
  repository: "src/lib/assurance/assurance-order-repository.ts",
  domain: "src/lib/assurance/assurance-order-domain.ts",
  audit: "src/lib/audit/audit-domain.ts"
});

function source(path) {
  assert.equal(existsSync(resolve(path)), true, `${path} must exist`);
  return readFileSync(resolve(path), "utf8");
}

test("M2.01 service exposes draft, target, validate, submit and controlled cancellation commands", () => {
  const service = source(files.service);
  for (const marker of [
    "createDraft",
    "saveDraft",
    "addWorkerTarget",
    "removeWorkerTarget",
    "validateOrder",
    "submitOrder",
    "cancelDraft",
    "cancelSubmittedOrder"
  ]) assert.match(service, new RegExp(`\\b${marker}\\b`));

  assert.match(service, /company_worker_links/);
  assert.match(service, /link_status[\s\S]{0,80}active/);
  assert.match(service, /company_sites/);
  assert.match(service, /company_departments/);
  assert.match(service, /company_verification_cases/);
  assert.match(service, /DatabaseAuditRepository/);
  assert.match(service, /transaction/i);
});

test("M2.01 validation fails closed for unbuilt later-brick dependencies instead of faking READY", () => {
  const service = source(files.service);
  const domain = source(files.domain);
  assert.match(service, /assessmentFrameworkReferences/);
  assert.match(service, /interviewRequired/);
  assert.match(service, /credentialTarget/);
  assert.match(service, /dependency|not available|not yet available|unavailable/i);
  assert.match(domain, /validation/i);
  assert.ok(!/mock.*framework|fake.*fund|assume.*available/i.test(service));
});

test("M2.01 submission is written as a duplicate-safe atomic case creation boundary", () => {
  const service = source(files.service);
  const repository = source(files.repository);
  assert.match(service, /submitOrder/);
  assert.match(`${service}\n${repository}`, /FOR UPDATE/i);
  assert.match(`${service}\n${repository}`, /ON CONFLICT|idempot/i);
  assert.match(`${service}\n${repository}`, /assurance_cases/);
  assert.match(`${service}\n${repository}`, /assurance_case_timeline_events/);
  assert.match(`${service}\n${repository}`, /assurance_action_items/);
  assert.match(`${service}\n${repository}`, /owner_kind/);
  assert.match(`${service}\n${repository}`, /next_action/);
  assert.ok(!/\bprocessing\b/i.test(`${service}\n${repository}`));
});

test("M2.01 uses centralized audit actions and does not write platform audit rows directly", () => {
  const service = source(files.service);
  const repository = source(files.repository);
  const audit = source(files.audit);
  for (const action of [
    "assurance_order.created",
    "assurance_order.updated",
    "assurance_order.validated",
    "assurance_order.submitted",
    "assurance_order.cancelled",
    "assurance_case.created",
    "assurance_case.status.changed",
    "assurance_action.created",
    "assurance_action.assigned",
    "assurance_action.acknowledged",
    "assurance_action.snoozed"
  ]) assert.ok(audit.includes(action), action);
  assert.ok(!/INSERT\s+INTO\s+platform_audit_events/i.test(`${service}\n${repository}`));
});
