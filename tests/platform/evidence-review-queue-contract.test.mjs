import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const paths = {
  migration: "database/migrations/0034_evidence_verification_queues.up.sql",
  domain: "src/lib/review/evidence-review-domain.ts",
  service: "src/lib/review/evidence-review-service.ts",
  verifierQueue: "src/app/verifier/(portal)/reviews/page.tsx",
  verifierDetail: "src/app/verifier/(portal)/reviews/[taskId]/page.tsx",
  verifierActions: "src/app/verifier/(portal)/reviews/actions.ts",
  previewRoute: "src/app/verifier/(portal)/reviews/[taskId]/preview/route.ts",
  companyOrderActions: "src/app/company/(portal)/assurance-orders/actions.ts",
  companyOrderWorkspace: "src/components/company/assurance-order-workspace.tsx"
};

function source(path) {
  assert.equal(existsSync(path), true, `${path} must exist`);
  return readFileSync(path, "utf8");
}

test("M2.02 owns exact-version evidence tasks, conflicts and immutable decisions", () => {
  const migration = source(paths.migration);
  for (const table of [
    "evidence_review_tasks",
    "evidence_review_decisions",
    "evidence_review_conflicts",
    "supervisor_observations"
  ]) assert.match(migration, new RegExp(table));
  assert.match(migration, /APPROVED/);
  assert.match(migration, /REJECTED/);
  assert.match(migration, /CHANGES_REQUESTED/);
  assert.match(migration, /append-only/i);
  assert.doesNotMatch(migration, /ON\s+DELETE\s+CASCADE/i);
});

test("M2.02 verifier service enforces fixed-role permission, assignment and one-decision concurrency", () => {
  const domain = source(paths.domain);
  const service = source(paths.service);
  for (const kind of ["identity","qualification","experience","employment","skill","supervisor_observation"])
    assert.match(domain, new RegExp(`\\"${kind}\\"`));
  for (const permission of ["verification.assigned.read","verification.assigned.decide"])
    assert.match(`${domain}\n${service}`, new RegExp(permission.replaceAll(".", "\\.")));
  assert.match(service, /claim/i);
  assert.match(service, /conflict/i);
  assert.match(service, /CHANGES_REQUESTED/);
  assert.match(service, /DatabaseAuditRepository/);
  assert.doesNotMatch(service, /INSERT\s+INTO\s+platform_audit_events/i);
});

test("M2.02 Reviewer routes show Worker, evidence version and secure preview without browser authority", () => {
  const pages = `${source(paths.verifierQueue)}\n${source(paths.verifierDetail)}\n${source(paths.verifierActions)}`;
  assert.match(pages, /requirePlatformPermission/);
  assert.match(pages, /verification\.assigned\.read/);
  assert.match(pages, /verification\.assigned\.decide/);
  assert.match(pages, /Worker/);
  assert.match(pages, /evidence/i);
  assert.match(pages, /version/i);
  assert.match(pages, /preview/i);
  for (const field of ["tenantId","workerAccountId","secureFileId","storageKey","objectKey"])
    assert.doesNotMatch(pages, new RegExp(`formData\\.get\\([\"']${field}[\"']\\)`));
});

test("M2.02 Company case handoff is a server-authorized production path into the review queue", () => {
  const actions = source(paths.companyOrderActions);
  const workspace = source(paths.companyOrderWorkspace);
  assert.match(actions, /queueAssuranceCaseEvidenceAction/);
  assert.match(actions, /requireCurrentTenantPermission\(["']company\.orders\.manage["']\)/);
  assert.match(actions, /EvidenceReviewService/);
  assert.match(actions, /queueCaseEvidence\(principal,caseId/);
  assert.match(workspace, /queueAssuranceCaseEvidenceAction/);
  assert.match(workspace, /Queue evidence review/);
  assert.match(workspace, /name=["']caseId["']/);
  for (const forbidden of ["tenantId","workerAccountId","secureFileId","sourceVersionId"])
    assert.doesNotMatch(actions, new RegExp(`formData\\.get\\([\"']${forbidden}[\"']\\)`));
});

test("M2.02 preview converts secure-file bytes to a Response-safe owned buffer", () => {
  const preview = source(paths.previewRoute);
  assert.match(preview, /Uint8Array\.from\(content\.bytes\)/);
  assert.doesNotMatch(preview, /new Response\(content\.bytes/);
});

test("M2.02 secure-file delegation is explicitly typed and never escapes through any", () => {
  const service = source(paths.service);
  assert.doesNotMatch(service, /query\s*<\s*any\s*>/);
  assert.doesNotMatch(service, /\bas\s+any\b/);
});
