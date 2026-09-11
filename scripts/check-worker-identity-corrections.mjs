import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path) {
  const full = resolve(path);
  assert.equal(existsSync(full), true, `${path} must exist.`);
  return readFileSync(full, "utf8");
}
function mustContain(text, pattern, message) {
  assert.match(text, pattern, message);
}
function mustNotContain(text, pattern, message) {
  assert.doesNotMatch(text, pattern, message);
}

const packageDocument = JSON.parse(source("package.json"));
const migration = source("database/migrations/0021_worker_identity_corrections.up.sql");
const migrationDown = source("database/migrations/0021_worker_identity_corrections.down.sql");
const domain = source("src/lib/identity/worker-identity-correction-domain.ts");
const repository = source("src/lib/identity/worker-identity-correction-repository.ts");
const service = source("src/lib/identity/worker-identity-correction-service.ts");
const identityService = source("src/lib/identity/worker-identity-service.ts");
const draftRepository = source("src/lib/identity/worker-identity-draft-repository.ts");
const draftService = source("src/lib/identity/worker-identity-draft-service.ts");
const localProcessing = source("src/lib/identity/worker-identity-local-processing-service.ts");
const page = source("src/app/worker/(portal)/identity/page.tsx");
const actions = source("src/app/worker/(portal)/identity/actions.ts");
const workspace = source("src/components/worker/identity-workspace.tsx");
const navigation = source("src/components/worker/worker-navigation.tsx");
const runner = source("scripts/run-worker-identity-correction-tests.mjs");
const domainTests = source("tests/identity/worker-identity-correction-domain.test.mjs");
const initialContactTests = source("tests/platform/worker-identity-initial-contact-binding.test.mjs");
const platformTests = source("tests/platform/worker-identity-corrections.test.mjs");
const migrationTests = source("tests/platform/worker-identity-correction-migration-stack.test.mjs");
const finalTests = source("tests/platform/m1-07-final-acceptance.test.mjs");

assert.equal(
  packageDocument.scripts["check:worker-identity-corrections"],
  "node scripts/check-worker-identity-corrections.mjs"
);
assert.equal(
  packageDocument.scripts["test:worker-identity-corrections"],
  "node scripts/run-worker-identity-correction-tests.mjs"
);
assert.equal(
  packageDocument.scripts["test:m1-07-final"],
  "node --test tests/platform/m1-07-final-acceptance.test.mjs"
);
for (const aggregate of ["verify:quick", "check"]) {
  mustContain(
    packageDocument.scripts[aggregate],
    /npm run check:worker-identity-corrections(?:\s|$)/,
    `${aggregate} must execute the S6 source guard.`
  );
}
for (const aggregate of ["test:integration", "check"]) {
  mustContain(
    packageDocument.scripts[aggregate],
    /npm run test:worker-identity-corrections(?:\s|$)/,
    `${aggregate} must execute the S6 runtime suite.`
  );
  mustContain(
    packageDocument.scripts[aggregate],
    /npm run test:m1-07-final(?:\s|$)/,
    `${aggregate} must execute the cumulative M1.07 final suite.`
  );
}

for (const marker of [
  "worker_identity_correction_requests",
  "worker_identity_correction_decisions",
  "worker_identity_correction_evidence_origins",
  "Worker identity correction history is immutable",
  "MAX(version_number)",
  "correction_pending",
  "worker_identity_correction_decisions"
]) {
  mustContain(
    migration,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    `S6 migration must retain ${marker}.`
  );
}
mustContain(
  migrationDown,
  /logical\/monotonic/i,
  "S6 rollback must remain monotonic because correction history is immutable."
);
mustNotContain(
  migration,
  /worker_identity\.correction\.(?:requested|submitted|decided)/,
  "S6 must not create a database-only audit vocabulary outside the typed audit domain."
);

for (const marker of [
  "TRUSTED_CORRECTION_AUTHORITIES",
  "createWorkerIdentityCorrectionRequestId",
  "createWorkerIdentityCorrectionDecisionId",
  "accepted",
  "rejected",
  "normalizeWorkerIdentityCorrectionReason"
]) {
  mustContain(domain, new RegExp(marker), `S6 domain must retain ${marker}.`);
}
for (const marker of [
  "requestOwn(",
  "submitOwn(",
  "decide(",
  "MAX(version_number)",
  "worker_identity_correction_evidence_origins",
  "WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL",
  "correctionVersionNumber",
  "activeVersionNumber"
]) {
  mustContain(
    repository,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S6 repository must retain ${marker}.`
  );
}
for (const forbidden of [
  /DELETE\s+FROM\s+worker_identity_versions/i,
  /DELETE\s+FROM\s+worker_identity_evidence_bindings/i,
  /UPDATE\s+auth_accounts/i,
  /INSERT\s+INTO\s+auth_account_roles/i
]) {
  mustNotContain(
    repository,
    forbidden,
    "S6 corrections must never erase identity history or grant account authority."
  );
}
for (const marker of [
  "createTrustedWorkerIdentityCorrectionAuthority",
  "worker.self.manage",
  "requestOwn",
  "submitOwn",
  "decide"
]) {
  mustContain(
    service,
    new RegExp(marker.replaceAll(".", "\\.")),
    `S6 service must retain ${marker}.`
  );
}

for (const marker of [
  "ensureDraft(",
  "submit(",
  "withdraw("
]) {
  mustContain(
    identityService,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `Worker Identity service public contract must retain ${marker}.`
  );
}
for (const marker of ["load(", "loadOrInitialize(", "save("]) {
  mustContain(
    draftService,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `Worker Identity draft service public contract must retain ${marker}.`
  );
}
for (const marker of [
  "ensureOwn(",
  "requireVerifiedContacts",
  "verified_email_normalized",
  "verified_phone_e164",
  "ON CONFLICT (identity_version_id) DO NOTHING"
]) {
  mustContain(
    draftRepository,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `Initial verified-contact binding must retain ${marker}.`
  );
}

for (const marker of [
  "processNextOutboxJob",
  "getServerEnvironment",
  "development",
  "test",
  "MAX_LOCAL_PROCESSING_STEPS",
  "settleLocalWorkerIdentityFileScan",
  "settleLocalWorkerIdentityAutomatedChecks",
  "provider_unavailable",
  "scan_failed"
]) {
  mustContain(
    localProcessing,
    new RegExp(marker),
    `S6 local semantic processing service must retain ${marker}.`
  );
}
mustNotContain(
  localProcessing,
  /export\s+.*(?:lease|jobId|claimedJob|outboxRepository)/i,
  "S6 local processing service must not expose raw outbox capabilities."
);

mustContain(
  page,
  /requirePortalAuthorization\("worker"\)/,
  "Worker Identity route must be Worker-authorized server-side."
);
mustContain(
  page,
  /identityService\.ensureDraft\(principal\)/,
  "Worker Identity route must use the Worker Identity service public draft contract."
);
mustContain(
  page,
  /draftService\.loadOrInitialize\(principal\)/,
  "Worker Identity route must bind verified account contacts before the first visible draft render."
);
mustContain(page, /IdentityWorkspace/, "Worker Identity route must render the real workspace.");
mustContain(navigation, /\/worker\/identity/, "Worker navigation must expose the real Identity route.");
for (const marker of [
  "saveWorkerIdentityDraftAction",
  "uploadWorkerIdentityEvidenceAction",
  "submitWorkerIdentityAction",
  "scheduleWorkerIdentityChecksAction",
  "requestWorkerIdentityCorrectionAction",
  "submitWorkerIdentityCorrectionAction",
  "createTrustedSecureFileUploadPolicy",
  "getSecureFileScanService",
  "settleLocalWorkerIdentityFileScan",
  "settleLocalWorkerIdentityAutomatedChecks",
  "requirePortalAuthorization"
]) {
  mustContain(actions, new RegExp(marker), `S6 actions must retain ${marker}.`);
}
for (const marker of [
  "getWorkerIdentityDraftService().save(",
  "getWorkerIdentityService().submit(",
  "getWorkerIdentityService().withdraw(",
  "getWorkerIdentityService().ensureDraft("
]) {
  mustContain(
    actions,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S6 actions must consume the service public API: ${marker}.`
  );
}
for (const forbidden of [
  /getWorkerIdentityService\(\)\.(?:ensureOwnDraft|submitOwn|withdrawOwn)\(/,
  /getWorkerIdentityDraftService\(\)\.(?:loadOwn|saveOwn)\(/,
  /from ["'][^"']*\/outbox\/outbox-(?:domain|repository|worker)["']/,
  /processNextOutboxJob/,
  /export\s+async\s+function\s+.*decide.*Correction/i,
  /candidateIdentityId/,
  /candidate_identity_id/
]) {
  mustNotContain(
    actions,
    forbidden,
    "Worker browser actions must use service contracts and must not expose raw outbox, reviewer or duplicate-decision authority."
  );
}
for (const marker of [
  "Verified account contacts",
  "Identity details",
  "Identity evidence",
  "Automated identity checks",
  "Permanent Worker ID",
  "Request a verified identity correction",
  "Awaiting authorized decision",
  "provider_unavailable",
  "expectedDraftRevision",
  "expectedActiveBindingId"
]) {
  mustContain(workspace, new RegExp(marker), `S6 visible workspace must retain ${marker}.`);
}
mustNotContain(
  workspace,
  /name="(?:verifiedEmail|verifiedPhone|email|phone)"/,
  "Verified identity contacts must never become browser-editable authority."
);

for (const marker of [
  "collectRuntimeSources",
  "HSE_WORKER_IDENTITY_CORRECTION_RUNTIME_DIST",
  "worker-identity-correction-domain.test.mjs",
  "worker-identity-initial-contact-binding.test.mjs",
  "worker-identity-corrections.test.mjs",
  "worker-identity-correction-migration-stack.test.mjs"
]) {
  mustContain(runner, new RegExp(marker), `S6 runtime runner must retain ${marker}.`);
}
for (const [text, pattern, label] of [
  [domainTests, /cannot be forged/i, "non-forgeable correction authority"],
  [initialContactTests, /initial verified contact binding exists before the first personal-detail save/i, "first-render verified contact binding"],
  [initialContactTests, /must not create or revise the draft/i, "idempotent first-render binding"],
  [platformTests, /never rewrites the verified parent/i, "parent immutability"],
  [platformTests, /never reuse a rejected version number/i, "monotonic correction sequence"],
  [platformTests, /session revocation/i, "session revocation isolation"],
  [migrationTests, /close and reopen/i, "restart persistence"],
  [migrationTests, /rollback is monotonic/i, "monotonic rollback"],
  [migrationTests, /append-only/i, "append-only correction history"],
  [finalTests, /all six identity subunits/i, "cumulative M1.07 coverage"]
]) {
  mustContain(text, pattern, `S6 acceptance tests must retain ${label}.`);
}

for (const text of [
  domain,
  repository,
  service,
  draftRepository,
  draftService,
  localProcessing,
  actions,
  workspace,
  initialContactTests,
  platformTests,
  migrationTests,
  finalTests
]) {
  mustNotContain(
    text,
    /@ts-ignore|@ts-expect-error|\bas any\b|as unknown as/,
    "S6 must not bypass type/security boundaries."
  );
}

console.log(
  "Worker identity S6 correction lineage, immutable history, first-render verified contacts, Worker-only UX, service-contract consumers, private evidence, semantic local processing, assistive checks, eligibility display, route authority and cumulative acceptance guards passed."
);
