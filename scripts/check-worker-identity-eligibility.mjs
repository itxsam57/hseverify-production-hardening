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
const migration = source("database/migrations/0020_worker_identity_duplicate_worker_id.up.sql");
const migrationDown = source("database/migrations/0020_worker_identity_duplicate_worker_id.down.sql");
const auditDomain = source("src/lib/audit/audit-domain.ts");
const domain = source("src/lib/identity/worker-identity-eligibility-domain.ts");
const repository = source("src/lib/identity/worker-identity-eligibility-repository.ts");
const service = source("src/lib/identity/worker-identity-eligibility-service.ts");
const runner = source("scripts/run-worker-identity-eligibility-tests.mjs");
const domainTests = source("tests/identity/worker-identity-eligibility-domain.test.mjs");
const platformTests = source("tests/platform/worker-identity-eligibility.test.mjs");
const migrationTests = source("tests/platform/worker-identity-eligibility-migration-stack.test.mjs");

assert.equal(
  packageDocument.scripts["check:worker-identity-eligibility"],
  "node scripts/check-worker-identity-eligibility.mjs"
);
assert.equal(
  packageDocument.scripts["test:worker-identity-eligibility"],
  "node scripts/run-worker-identity-eligibility-tests.mjs"
);
for (const aggregate of ["verify:quick", "check"]) {
  mustContain(
    packageDocument.scripts[aggregate],
    /npm run check:worker-identity-eligibility(?:\s|$)/,
    `${aggregate} must execute the S5 source guard.`
  );
}
for (const aggregate of ["test:integration", "check"]) {
  mustContain(
    packageDocument.scripts[aggregate],
    /npm run test:worker-identity-eligibility(?:\s|$)/,
    `${aggregate} must execute the S5 runtime suite.`
  );
}

for (const marker of [
  "worker_identity_duplicate_checks",
  "worker_identity_duplicate_signals",
  "worker_identity_duplicate_dispositions",
  "worker_identity_worker_ids",
  "verified_email_exact",
  "verified_phone_exact",
  "identity_document_exact",
  "legal_name_dob_exact",
  "recover_existing_account",
  "duplicate_review",
  "block_worker_id",
  "Permanent Worker ID requires the exact current verified identity version",
  "Permanent Worker ID is blocked by unresolved duplicate or recovery eligibility",
  "worker_identity.duplicate.evaluated",
  "worker_identity.duplicate.disposition.recorded",
  "worker_identity.worker_id.issued"
]) {
  mustContain(
    migration,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S5 migration must retain ${marker}.`
  );
}
mustContain(
  migrationDown,
  /logical\/monotonic/i,
  "S5 rollback must remain logical/monotonic because eligibility history and permanent Worker IDs are immutable."
);
for (const action of [
  "worker_identity.duplicate.evaluated",
  "worker_identity.duplicate.disposition.recorded",
  "worker_identity.worker_id.issued"
]) {
  mustContain(
    auditDomain,
    new RegExp(action.replaceAll(".", "\\.")),
    `Typed audit vocabulary must retain ${action}.`
  );
}

for (const marker of [
  "TRUSTED_IDENTITY_ELIGIBILITY_AUTHORITIES",
  "identity-assurance",
  "evaluateWorkerIdentityDuplicateSignals",
  "normalizeIdentityDocumentNumber",
  "normalizeIdentityLegalName",
  "dispositionAllowsPermanentWorkerId",
  "createPermanentWorkerId",
  "worker_id_"
]) {
  mustContain(
    domain,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S5 domain must retain ${marker}.`
  );
}

for (const marker of [
  "evaluate(",
  "recordDisposition(",
  "issuePermanentWorkerId(",
  "loadOwnStatus(",
  "worker_identity_duplicate_signals",
  "worker_identity_worker_ids",
  "lifecycle_status !== \"verified\"",
  "ON CONFLICT DO NOTHING",
  "WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL"
]) {
  mustContain(
    repository,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S5 repository must retain ${marker}.`
  );
}
for (const forbidden of [
  /DELETE\s+FROM\s+worker_identities/i,
  /UPDATE\s+auth_accounts/i,
  /UPDATE\s+worker_identities[\s\S]{0,120}worker_account_id/i,
  /INSERT\s+INTO\s+auth_account_roles/i
]) {
  mustNotContain(
    repository,
    forbidden,
    "S5 duplicate/recovery work must not merge, reassign or grant account authority."
  );
}

for (const marker of [
  "createTrustedWorkerIdentityEligibilityAuthority",
  "evaluate(identityId",
  "recordDisposition",
  "issuePermanentWorkerId",
  "loadOwnStatus"
]) {
  mustContain(
    service,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S5 server service must retain ${marker}.`
  );
}

for (const marker of [
  "collectRuntimeSources",
  "HSE_WORKER_IDENTITY_ELIGIBILITY_RUNTIME_DIST",
  "worker-identity-eligibility-domain.test.mjs",
  "worker-identity-eligibility.test.mjs",
  "worker-identity-eligibility-migration-stack.test.mjs"
]) {
  mustContain(
    runner,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S5 runtime runner must retain ${marker}.`
  );
}
for (const [text, pattern, label] of [
  [domainTests, /cannot be forged/i, "non-forgeable authority coverage"],
  [domainTests, /fail-closed/i, "fail-closed disposition coverage"],
  [platformTests, /never merge accounts/i, "no-auto-merge runtime coverage"],
  [platformTests, /re-evaluation supersedes/i, "repeat-evaluation coverage"],
  [platformTests, /refuses issuance before verified/i, "verified-only issuance coverage"],
  [migrationTests, /close and reopen/i, "restart coverage"],
  [migrationTests, /rollback is monotonic/i, "monotonic rollback coverage"],
  [migrationTests, /append-only/i, "immutability coverage"]
]) {
  mustContain(text, pattern, `S5 acceptance tests must retain ${label}.`);
}

for (const text of [domain, repository, service, platformTests, migrationTests]) {
  mustNotContain(
    text,
    /src\/app\/(?:worker|company|assessor|verifier|admin|root)\//,
    "S5 must not pull the S6 Worker identity UI or M2.02 reviewer UI forward."
  );
  mustNotContain(
    text,
    /@ts-ignore|@ts-expect-error|\bas any\b|as unknown as/,
    "S5 must not bypass type/security boundaries."
  );
}

console.log(
  "Worker identity S5 duplicate signals, recovery dispositions, verified-only permanent Worker-ID eligibility, immutable history, own-read isolation and migration/restart guards passed."
);
