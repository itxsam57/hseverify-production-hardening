import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function fail(message) {
  console.error(`M2.01 source guard failed: ${message}`);
  process.exit(1);
}
function read(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) fail(`required surface is missing: ${path}`);
  return readFileSync(absolute, "utf8");
}
function requireMarker(text, marker, label) {
  if (!text.includes(marker)) fail(`${label} is missing required marker: ${marker}`);
}
function requirePattern(text, pattern, label, fact) {
  if (!pattern.test(text)) fail(`${label} is missing contract evidence: ${fact}`);
}
function forbidPattern(text, pattern, label, fact) {
  if (pattern.test(text)) fail(`${label} contains forbidden contract evidence: ${fact}`);
}
function filesUnder(directory) {
  const absolute = resolve(directory);
  if (!existsSync(absolute)) return [];
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

const paths = Object.freeze({
  migrationUp: "database/migrations/0033_assurance_order_case_engine.up.sql",
  migrationDown: "database/migrations/0033_assurance_order_case_engine.down.sql",
  domain: "src/lib/assurance/assurance-order-domain.ts",
  repository: "src/lib/assurance/assurance-order-repository.ts",
  service: "src/lib/assurance/assurance-order-service.ts",
  actionCentreService: "src/lib/assurance/assurance-action-centre-service.ts",
  orderActions: "src/app/company/(portal)/assurance-orders/actions.ts",
  orderPage: "src/app/company/(portal)/assurance-orders/page.tsx",
  newPage: "src/app/company/(portal)/assurance-orders/new/page.tsx",
  detailPage: "src/app/company/(portal)/assurance-orders/[orderId]/page.tsx",
  workspace: "src/components/company/assurance-order-workspace.tsx",
  actionActions: "src/app/company/(portal)/action-centre/actions.ts",
  actionPage: "src/app/company/(portal)/action-centre/page.tsx",
  actionComponent: "src/components/company/assurance-action-centre.tsx",
  portalShell: "src/components/auth/role-portal-shell.tsx",
  domainTest: "tests/platform/assurance-order-case-domain.test.mjs",
  migrationTest: "tests/platform/assurance-order-case-migration.test.mjs",
  serviceTest: "tests/platform/assurance-order-case-service.test.mjs",
  routeTest: "tests/platform/assurance-order-case-routes.test.mjs",
  runtimeTest: "tests/platform/assurance-order-case-runtime.test.mjs",
  runtimeRunner: "scripts/run-assurance-order-case-runtime-tests.mjs",
  runner: "scripts/run-assurance-order-case-tests.mjs"
});
const source = Object.fromEntries(Object.entries(paths).map(([key,path]) => [key,read(path)]));

for (const status of [
  "DRAFT","VALIDATION_FAILED","READY","SUBMITTED","PARTIALLY_FUNDED","ACTIVE","COMPLETED","CANCELLED","CLOSED"
]) requireMarker(source.domain, `"${status}"`, paths.domain);
for (const status of [
  "Created","Awaiting worker acceptance","Identity pending","Evidence pending","Funding pending","Assessment pending",
  "Assessment in progress","Review pending","Interview pending","Decision pending","Approved","Conditionally approved",
  "Reassessment required","Rejected","Suspended","Closed"
]) requireMarker(source.domain, `"${status}"`, paths.domain);
for (const owner of ["worker","company","reviewer","assessor","admin","payment","background_job"])
  requireMarker(source.domain, `"${owner}"`, paths.domain);
forbidPattern(source.domain, /["']processing["']/i, paths.domain, "ambiguous processing state");
requireMarker(source.domain, '"company.orders.read"');
requireMarker(source.domain, '"company.orders.manage"');

for (const table of ["assurance_orders","assurance_order_workers","assurance_cases","assurance_case_timeline_events","assurance_action_items"])
  requireMarker(source.migrationUp, table, paths.migrationUp);
requirePattern(source.migrationUp, /UNIQUE\s*\(\s*order_id\s*,\s*worker_account_id\s*\)/i, paths.migrationUp, "one Assurance Case per order/Worker");
requirePattern(source.migrationUp, /Submitted Assurance Order scope is immutable/i, paths.migrationUp, "submitted order immutability guard");
requirePattern(source.migrationUp, /Submitted Assurance Order worker scope cannot be modified/i, paths.migrationUp, "submitted Worker target immutability guard");
requirePattern(source.migrationUp, /timeline is append-only/i, paths.migrationUp, "append-only Assurance Case timeline");
requirePattern(source.migrationDown, /monotonic[\s\S]*SELECT\s+1/i, paths.migrationDown, "monotonic history-preserving rollback");
forbidPattern(source.migrationDown, /DROP\s+(?:TABLE|TRIGGER|FUNCTION|INDEX)/i, paths.migrationDown, "destructive M2.01 rollback");
forbidPattern(source.migrationUp, /REFERENCES\s+(?:company_worker_links|company_sites|company_departments|company_verification_cases|worker_identity_worker_ids|platform_secure_files)/i, paths.migrationUp, "hard foreign key into a lower brick");
forbidPattern(source.migrationUp, /ON\s+DELETE\s+CASCADE/i, paths.migrationUp, "cascade deletion of assurance history");

for (const marker of ["createDraft","saveDraft","addWorkerTarget","removeWorkerTarget","validateOrder","submitOrder","cancelDraft","cancelSubmittedOrder","runTenantScopedCommand"])
  requireMarker(source.service, marker, paths.service);
requirePattern(source.service, /transaction boundary/i, paths.service, "explicit trusted transactional command boundary");
requireMarker(source.service, "company_verification_cases", paths.service);
requireMarker(source.service, "company_worker_links", paths.service);
for (const laterDependency of [
  "Interview scheduling dependency is not yet available in M2.01.",
  "Credential target dependency is not yet available in M2.01."
]) requireMarker(source.service, laterDependency, paths.service);
for (const m203Integration of ["validateAssurancePolicySelection","pinAssuranceCasePolicySnapshot"])
  requireMarker(source.service, m203Integration, paths.service);
forbidPattern(source.service, /Assessment framework dependency is not yet available in M2\.01\.|Effective policy dependency is not yet available in M2\.01\./, paths.service, "obsolete M2.01 framework/policy blocker after M2.03");
requirePattern(`${source.service}\n${source.actionCentreService}`, /DatabaseAuditRepository/, "M2.01 service boundary", "centralized audit repository usage");
forbidPattern(`${source.service}\n${source.repository}\n${source.actionCentreService}`, /INSERT\s+INTO\s+platform_audit_events/i, "M2.01 service boundary", "direct audit-table writes");

for (const field of ["severity","reason","dueAt","owner","allowedAction","deepLink"])
  requireMarker(source.actionCentreService, `"${field}"`, paths.actionCentreService);
for (const command of ["assignOwner","acknowledge","snooze"])
  requireMarker(source.actionCentreService, command, paths.actionCentreService);
requirePattern(source.actionCentreService, /Only a Company-owned action can be assigned internally/i, paths.actionCentreService, "safe internal assignment boundary");
requirePattern(source.actionCentreService, /Only non-statutory informational actions can be snoozed/i, paths.actionCentreService, "safe snooze boundary");

requireMarker(source.orderActions, '"use server"', paths.orderActions);
requireMarker(source.actionActions, '"use server"', paths.actionActions);
for (const permission of ["company.orders.read","company.orders.manage"])
  requirePattern(`${source.orderActions}\n${source.orderPage}\n${source.newPage}\n${source.detailPage}\n${source.actionActions}\n${source.actionPage}`, new RegExp(permission.replaceAll(".","\\.")), "Company Assurance routes", `server-side ${permission} enforcement`);
for (const authorityField of ["tenantId","membershipId","actorAccountId","actorRole","ownerAccountId"])
  forbidPattern(`${source.orderActions}\n${source.actionActions}`, new RegExp(`formData\\.get\\([\"']${authorityField}[\"']\\)`), "M2.01 Server Actions", `browser-selected authority ${authorityField}`);
for (const marker of ["Assurance Orders","Action Centre"])
  requireMarker(source.portalShell, marker, paths.portalShell);

for (const path of [paths.domainTest,paths.migrationTest,paths.serviceTest,paths.routeTest,paths.runtimeTest,paths.runtimeRunner,paths.runner]) read(path);
for (const hardCase of [
  "concurrent submit race",
  "copied IDs cannot cross tenants",
  "timeline update/delete tampering",
  "submitted cancellation closes cases",
  "blocks unsafe assignment and snoozing"
]) requirePattern(source.runtimeTest, new RegExp(hardCase.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"), paths.runtimeTest, hardCase);
requirePattern(source.runtimeTest, /Array\.from\(\{length:12\}/, paths.runtimeTest, "12-way concurrent submit race");

const m201Production = [
  ...filesUnder("src/lib/assurance"),
  ...filesUnder("src/app/company/(portal)/assurance-orders"),
  ...filesUnder("src/app/company/(portal)/action-centre")
].map(file => readFileSync(file,"utf8")).join("\n");
forbidPattern(m201Production, /question_bank|assessment_questions|assessment_form_reserv|written_rubric|answer_key/i, "M2.01 production boundary", "M2.04/M2.05 question-bank or form-generation authority");
forbidPattern(m201Production, /issueCredential|credential_issuance|living.?record|scoped.?share/i, "M2.01 production boundary", "M3 credential/living-record/share-link authority");
forbidPattern(m201Production, /approveEvidence|rejectEvidence|changesRequestedEvidence|reviewerQueue/i, "M2.01 production boundary", "M2.02 evidence decision authority");

console.log("M2.01 Assurance Order and Case Engine source contract passed: tenant-scoped draft/validation/submission, one case per Worker, immutable timeline, explicit Action Centre ownership, safe commands, concurrency hard tests, centralized audit, M2.03 policy integration and remaining later-brick fail-closed boundaries are present.");
