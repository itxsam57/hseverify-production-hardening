import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path) {
  const full = resolve(path);
  assert.equal(existsSync(full), true, `${path} must exist.`);
  return readFileSync(full, "utf8");
}
function mustContain(text, marker, message) {
  assert.equal(text.includes(marker), true, message ?? `Missing ${marker}`);
}
function mustMatch(text, pattern, message) {
  assert.match(text, pattern, message);
}
function mustNotContain(text, marker, message) {
  assert.equal(text.includes(marker), false, message ?? `Forbidden ${marker}`);
}

const packageDocument = JSON.parse(source("package.json"));
const domain = source("src/lib/identity/worker-identity-evidence-domain.ts");
const repository = source("src/lib/identity/worker-identity-evidence-repository.ts");
const service = source("src/lib/identity/worker-identity-evidence-service.ts");
const migration = source("database/migrations/0017_worker_identity_evidence_binding.up.sql");
const rollback = source("database/migrations/0017_worker_identity_evidence_binding.down.sql");
const freezeMigration = source("database/migrations/0018_worker_identity_evidence_freeze_guard.up.sql");
const freezeRollback = source("database/migrations/0018_worker_identity_evidence_freeze_guard.down.sql");
const runner = source("scripts/run-worker-identity-evidence-tests.mjs");
const platformTests = source("tests/platform/worker-identity-evidence.test.mjs");
const migrationTests = source("tests/platform/worker-identity-evidence-migration-stack.test.mjs");
const s2PlatformTests = source("tests/platform/worker-identity-draft.test.mjs");
const s2MigrationTests = source("tests/platform/worker-identity-draft-migration-stack.test.mjs");
const regressions = source("docs/engineering/M1_07_SUBUNIT3_REGRESSIONS.md");
const acceptance = source("docs/testing/results/M1_07_SUBUNIT3_ACCEPTANCE.md");

assert.equal(packageDocument.scripts["check:worker-identity-evidence"], "node scripts/check-worker-identity-evidence.mjs");
assert.equal(packageDocument.scripts["test:worker-identity-evidence"], "node scripts/run-worker-identity-evidence-tests.mjs");
for (const aggregate of ["verify:quick", "check"]) {
  mustMatch(packageDocument.scripts[aggregate], /npm run check:worker-identity-evidence(?:\s|$)/, `${aggregate} must retain the permanent S3 source/architecture guard.`);
}
for (const aggregate of ["test:integration", "check"]) {
  mustMatch(packageDocument.scripts[aggregate], /npm run test:worker-identity-evidence(?:\s|$)/, `${aggregate} must execute the permanent S3 runtime/migration suite.`);
}

for (const marker of [
  "WORKER_IDENTITY_EVIDENCE_PURPOSES", '"identity_document"', '"profile_photo"', '"selfie"',
  "WORKER_IDENTITY_DOCUMENT_TYPES", '"passport"', '"national_id"', '"residence_permit"',
  "normalizeWorkerIdentityEvidenceBindingInput", "normalizeWorkerIdentityEvidenceBindingReference",
  "normalizeSecureFileReference", "Secure identity evidence reference is invalid",
  "Photo and selfie evidence cannot carry identity-document metadata",
  "issue date cannot be after its expiry date"
]) mustContain(domain, marker, `S3 evidence domain must retain ${marker}.`);

for (const marker of [
  "CREATE TABLE IF NOT EXISTS worker_identity_evidence_bindings",
  "worker_identity_evidence_active_purpose_uidx", "worker_identity_evidence_validate_insert",
  "worker_identity_evidence_no_delete", "platform_secure_files AS files",
  "files.owner_account_id", "file_role <> 'worker'", "file_tenant IS NOT NULL",
  "file_membership IS NOT NULL", "file_status <> 'available'",
  "file_detected_mime NOT IN ('image/png', 'image/jpeg')",
  "Worker identity evidence requires an available secure file owned by the Worker",
  "Worker identity photo and selfie evidence must be an available image",
  "binding_status IN ('active', 'superseded')", "supersedes_binding_id",
  "COUNT(DISTINCT evidence.purpose)", "ready_evidence_count <> 3",
  "Worker identity document, profile photo and selfie evidence are incomplete or unavailable"
]) mustContain(migration, marker, `S3 evidence migration must retain ${marker}.`);

const tableBlock = migration.match(/CREATE TABLE IF NOT EXISTS worker_identity_evidence_bindings[\s\S]*?\n\);/)?.[0] ?? "";
for (const forbidden of [
  "REFERENCES platform_secure_files", "BYTEA", "base64", "object_key",
  "content_sha256", "storage_adapter_key", "reservation_key"
]) mustNotContain(tableBlock, forbidden, `S3 identity evidence table must not contain ${forbidden}.`);
for (const forbidden of ["DROP TABLE", "DELETE FROM"]) {
  mustNotContain(rollback, forbidden, "S3 rollback must preserve durable evidence history.");
  mustNotContain(freezeRollback, forbidden, "S3 hardening rollback must stay monotonic.");
}
mustMatch(rollback, /logical|monotonic/i, "S3 evidence rollback must remain logical/monotonic.");
mustMatch(freezeRollback, /monotonic/i, "S3 freeze rollback must retain the strongest accepted invariant.");

for (const marker of [
  "current editable Worker version", "bound_version_status <> 'draft'",
  "identity_status NOT IN ('draft', 'correction_pending')",
  "provenance and metadata are immutable", "OLD.binding_status <> 'active'",
  "NEW.binding_status <> 'superseded'"
]) mustContain(freezeMigration, marker, `S3 freeze guard must retain ${marker}.`);

for (const marker of [
  "WORKER_IDENTITY_EVIDENCE_LIVE_AUTHORITY_SQL", "sessions.active_role = 'worker'",
  "accounts.account_status = 'active'", "sessions.revoked_at IS NULL",
  "sessions.expires_at > CURRENT_TIMESTAMP", "FOR UPDATE OF sessions, accounts",
  "CURRENT_EDITABLE_VERSION_FOR_UPDATE_SQL", "FOR UPDATE OF identities, versions",
  "BINDABLE_SECURE_FILE_SQL", "lifecycle_status = 'available'", "owner_role = 'worker'",
  "tenant_id IS NULL", "membership_id IS NULL", "expectedActiveBindingId",
  "sameBinding(active, normalized)", "expectedActiveBindingId !== active.bindingId",
  "binding_status = 'superseded'", "supersedesBindingId = active.bindingId"
]) mustContain(repository, marker, `S3 repository must retain ${marker}.`);
for (const forbidden of ["clientAccountId", "requestedAccountId", "clientTenantId", "requestedTenantId", "objectKey", "contentSha256", "rawBytes"]) {
  mustNotContain(repository, forbidden, `S3 repository must not accept/leak ${forbidden}.`);
}

for (const marker of [
  "worker.self.manage", "assertWorkerIdentityEvidenceManagePermission",
  "identityRepository.ensureOwnDraft(worker)", "secureFiles.findForPrincipal",
  'file.lifecycleStatus !== "available"', 'file.detectedMime !== "image/png"',
  'file.detectedMime !== "image/jpeg"', "evidenceRepository.bindOwn(worker, normalized, expected)"
]) mustContain(service, marker, `S3 service must retain ${marker}.`);

for (const marker of [
  'const RUNTIME_STUBS = new Set(["database/database.ts"])', "function collectRuntimeSources",
  "ts.preProcessFile", "Worker identity evidence runtime test must inject a database client.",
  "worker-identity-evidence-domain.test.mjs", "worker-identity-evidence.test.mjs",
  "worker-identity-evidence-migration-stack.test.mjs"
]) mustContain(runner, marker, `S3 runtime runner must retain ${marker}.`);

for (const marker of [
  "preserves replacement history and freezes submitted evidence", "exact retry must be idempotent",
  "cross-account, unavailable, non-image photo and stale replacement authority",
  "submission stays blocked until document, profile photo and selfie",
  "platform_outbox_jobs", "secure_file.scan", "scan_generation = 1", "scan_job_id = $2",
  "scan_result_code = 'clean'", "WorkerIdentityEvidenceConflictError",
  "available secure file owned by the Worker", "current editable Worker version",
  'const OWNED_MIGRATION = "0018_worker_identity_evidence_freeze_guard"'
]) mustContain(platformTests, marker, `S3 platform test must retain ${marker}.`);
for (const marker of [
  "roll back logically, preserve history and reapply deterministically",
  "survive PGlite close and reopen", "0017_worker_identity_evidence_binding",
  "0018_worker_identity_evidence_freeze_guard", "platform_outbox_jobs", "secure_file.scan",
  "scan_generation = 1", "scan_job_id = $2", "scan_result_code = 'clean'",
  "rollbackLatestMigration", "applyMigrationsThrough"
]) mustContain(migrationTests, marker, `S3 migration test must retain ${marker}.`);

for (const marker of [
  "REG-075", "test-architecture regression", "Secure file initial scan binding is invalid.",
  "pending `secure_file.scan` outbox job", "existing M1.06 guards were not weakened"
]) mustContain(regressions, marker, `S3 regression record must retain ${marker}.`);

for (const testSource of [s2PlatformTests, s2MigrationTests]) {
  mustContain(testSource, "applyMigrationsThrough", "S2 tests must remain migration-ceiling isolated.");
  mustContain(testSource, "0016_worker_identity_draft_details", "S2 tests must explicitly stop at migration 0016.");
}

for (const marker of [
  "ENGINEERING PASS — 10 August 2026", "#61",
  "db40d8be93b1ea9064f86a16e2e1915d11b67d96", "31384894092",
  "00e92e967deedee6e5682423b74a8f26acaa2617", "31385318724", "REG-075"
]) mustContain(acceptance, marker, `S3 acceptance evidence must retain ${marker}.`);
mustMatch(
  acceptance,
  /browser\/owner test[^\n]{0,80}(?:not required|no browser-visible)/i,
  "S3 acceptance evidence must state semantically that no browser test is required for a non-visible subunit."
);

// Permanent S3 ownership ends at its accepted implementation, regression and
// acceptance evidence. Live roadmap progression belongs to check:engineering;
// coupling this historical guard to M1.07/M1.08 current-state prose recreates
// the established REG-061 stale-context failure class.
console.log("Worker identity S3 permanent secure-file binding, evidence lineage, stale-write protection, submission readiness, freeze, REG-075, migration isolation and acceptance guard passed.");
