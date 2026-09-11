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
const domain = source("src/lib/identity/worker-identity-draft-domain.ts");
const repository = source("src/lib/identity/worker-identity-draft-repository.ts");
const service = source("src/lib/identity/worker-identity-draft-service.ts");
const migration = source("database/migrations/0016_worker_identity_draft_details.up.sql");
const rollback = source("database/migrations/0016_worker_identity_draft_details.down.sql");
const runner = source("scripts/run-worker-identity-draft-tests.mjs");
const domainTests = source("tests/identity/worker-identity-draft-domain.test.mjs");
const platformTests = source("tests/platform/worker-identity-draft.test.mjs");
const migrationTests = source("tests/platform/worker-identity-draft-migration-stack.test.mjs");
const migrationCeiling = source("tests/helpers/migration-ceiling.mjs");
const s1PlatformTests = source("tests/platform/worker-identity-foundation.test.mjs");
const s1MigrationTests = source("tests/platform/worker-identity-migration-stack.test.mjs");
const acceptance = source("docs/testing/results/M1_07_SUBUNIT2_ACCEPTANCE.md");

assert.equal(
  packageDocument.scripts["check:worker-identity-draft"],
  "node scripts/check-worker-identity-draft.mjs"
);
assert.equal(
  packageDocument.scripts["test:worker-identity-draft"],
  "node scripts/run-worker-identity-draft-tests.mjs"
);
for (const aggregate of ["verify:quick", "check"]) {
  mustMatch(
    packageDocument.scripts[aggregate],
    /npm run check:worker-identity-draft(?:\s|$)/,
    `${aggregate} must retain the S2 source guard.`
  );
}
for (const aggregate of ["test:integration", "check"]) {
  mustMatch(
    packageDocument.scripts[aggregate],
    /npm run test:worker-identity-draft(?:\s|$)/,
    `${aggregate} must execute the S2 runtime/migration suite.`
  );
}

for (const marker of [
  "WorkerIdentityDraftInput",
  "WorkerIdentityVerifiedContacts",
  "WorkerIdentityDraftRecord",
  "WorkerIdentityContactVerificationRequiredError",
  "normalizeWorkerIdentityDraftInput",
  "normalizeWorkerIdentityDraftRevision",
  "Date of birth cannot be in the future"
]) mustContain(domain, marker, `S2 draft domain must retain ${marker}.`);
mustMatch(
  domain,
  /WorkerIdentityDraftInput = Readonly<\{[\s\S]*legalFirstName: string \| null;[\s\S]*countryOfResidence: string \| null;[\s\S]*\}>;/,
  "Draft input must allow incomplete server-persisted draft state."
);
for (const forbidden of [
  "emailNormalized:",
  "emailVerifiedAt:",
  "phoneE164:",
  "phoneVerifiedAt:"
]) {
  const inputBlock = domain.match(/WorkerIdentityDraftInput = Readonly<\{[\s\S]*?\}>;/)?.[0] ?? "";
  mustNotContain(inputBlock, forbidden, `Browser-editable draft input must not contain trusted contact authority: ${forbidden}`);
}

for (const marker of [
  "CREATE TABLE IF NOT EXISTS worker_identity_version_drafts",
  "worker_identity_draft_guard_write",
  "worker_identity_version_drafts_guard_write",
  "worker_identity_version_drafts_no_delete",
  "verified_email_normalized",
  "email_verified_at",
  "verified_phone_e164",
  "phone_verified_at",
  "accounts.account_status = 'active'",
  "roles.role = 'worker'",
  "NEW.verified_email_normalized := account_email",
  "NEW.verified_phone_e164 := account_phone",
  "identity_status NOT IN ('draft', 'correction_pending')",
  "Worker identity requires verified email and phone contacts",
  "Worker identity personal details and verified contacts are incomplete or stale",
  "draft_revision <> OLD.draft_revision + 1"
]) mustContain(migration, marker, `S2 migration must retain ${marker}.`);
mustMatch(
  migration,
  /ordinary partial draft saves are revision-traceable/i,
  "S2 migration must document that ordinary draft saves are revision-traceable rather than immutable security-audit events."
);
for (const forbidden of [
  "REFERENCES auth_accounts",
  "worker_profiles",
  "BYTEA",
  "base64",
  "object_key",
  "worker_identity.draft.saved"
]) mustNotContain(migration, forbidden, `S2 migration must not introduce ${forbidden}.`);
mustNotContain(rollback, "DROP TABLE", "S2 rollback must preserve durable identity draft history.");
mustNotContain(rollback, "DELETE FROM", "S2 rollback must preserve durable identity/contact history.");
mustContain(rollback, "logical", "S2 rollback must document monotonic logical rollback.");

for (const marker of [
  "WORKER_IDENTITY_DRAFT_LIVE_AUTHORITY_SQL",
  "sessions.active_role = 'worker'",
  "accounts.account_status = 'active'",
  "sessions.revoked_at IS NULL",
  "sessions.expires_at > CURRENT_TIMESTAMP",
  "FOR UPDATE OF sessions, accounts",
  "requireVerifiedContacts",
  "ON CONFLICT (identity_version_id) DO NOTHING",
  "draft_revision = draft_revision + 1",
  "AND draft_revision = $2",
  "normalizeWorkerIdentityDraftInput",
  "normalizeWorkerIdentityDraftRevision"
]) mustContain(repository, marker, `S2 repository must retain ${marker}.`);
for (const forbidden of [
  "clientAccountId",
  "requestedAccountId",
  "clientTenantId",
  "requestedTenantId",
  "reviewerId",
  "providerKey",
  "documentNumber",
  "objectKey",
  "rawBytes",
  "AUDIT_APPEND_SQL"
]) mustNotContain(repository, forbidden, `S2 repository must not accept unrelated/client authority: ${forbidden}`);

for (const marker of [
  "worker.self.manage",
  "assertWorkerIdentityDraftManagePermission",
  "identityRepository.ensureOwnDraft(worker)",
  "draftRepository.saveOwn"
]) mustContain(service, marker, `S2 service must retain ${marker}.`);

for (const marker of [
  'const RUNTIME_STUBS = new Set(["database/database.ts"])',
  "function collectRuntimeSources",
  "ts.preProcessFile",
  "Worker identity draft runtime test must inject a database client.",
  "worker-identity-draft-domain.test.mjs",
  "worker-identity-draft.test.mjs",
  "worker-identity-draft-migration-stack.test.mjs"
]) mustContain(runner, marker, `S2 runtime runner must retain ${marker}.`);

for (const marker of [
  "accepts incomplete state but normalizes committed personal facts",
  "rejects invalid dates, control characters and stale revision shapes"
]) mustContain(domainTests, marker, `S2 domain test must retain ${marker}.`);
for (const marker of [
  "bind verified contacts only from authentication authority",
  "denies missing mandatory contact verification",
  "draft optimistic concurrency admits one update",
  "submission is blocked until required facts are complete",
  "ordinary partial draft saves must not create immutable audit spam",
  "verified_email_normalized = 'forged@example.com'"
]) mustContain(platformTests, marker, `S2 platform test must retain ${marker}.`);
for (const marker of [
  "rollback is monotonic and deterministic",
  "survive PGlite close and reopen",
  "0016_worker_identity_draft_details",
  "rollbackLatestMigration",
  "migrationStatus"
]) mustContain(migrationTests, marker, `S2 migration test must retain ${marker}.`);

for (const marker of [
  "applyMigrationsThrough",
  "migrationChecksumCompatibility",
  "Migration ceiling test database already contains later migrations"
]) mustContain(migrationCeiling, marker, `Migration ceiling helper must retain ${marker}.`);
for (const testSource of [s1PlatformTests, s1MigrationTests]) {
  mustContain(testSource, "applyMigrationsThrough", "S1 tests must stay pinned to their accepted migration ceiling.");
  mustContain(testSource, "0015_worker_identity_foundation", "S1 tests must explicitly own migration 0015.");
}

for (const marker of [
  "M1.07 Subunit 2 Acceptance",
  "ENGINEERING PASS — 10 August 2026",
  "29350dd47b51471462e21cdebbe6f5b67ebc2c18",
  "31378294472",
  "61bdbde805ac4e27ade7a9c787559ff87b2dfb9d",
  "31378748392",
  "Subunit 3 — Secure Identity Document, Profile Photo and Selfie Evidence Binding"
]) mustContain(acceptance, marker, `S2 permanent acceptance must retain ${marker}.`);

// Permanent S2 product/regression checks deliberately do not own the current
// S3-S6 prose in NEXT_BUILD_UNIT. Live subunit state belongs to the active
// subunit checker; accepted S2 owns its implementation and evidence only.
console.log("Worker identity S2 draft/contact authority, concurrency, submission-readiness, migration isolation and permanent acceptance guard passed.");
