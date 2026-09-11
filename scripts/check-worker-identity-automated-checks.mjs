import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const EXPECTED_0013_CHECKSUM =
  "89a0168ff92b2d0df5dad4d5f1b9b99ab5d5a2c92c1b28ce7e03fdf9a16baada";
const PREVIOUS_0013_CHECKSUM =
  "8156083e26ac2c3ad354eddd44b13af801898db2d1cba35f2441c26ac2a18280";
const LEGACY_0013_CHECKSUM =
  "b20f0a844faee01315562d9673a75df0494908259a7997d4a0d9e421bb0742d2";

const packageDocument = JSON.parse(source("package.json"));
const historicalScanMigration = source(
  "database/migrations/0013_secure_file_malware_scan.up.sql"
).replace(/\r\n?/g, "\n");
const migration = source(
  "database/migrations/0019_worker_identity_automated_checks.up.sql"
);
const migrationDown = source(
  "database/migrations/0019_worker_identity_automated_checks.down.sql"
);
const migrationEngine = source("scripts/lib/migrations.mjs");
const outboxDomain = source("src/lib/outbox/outbox-domain.ts");
const outboxWorker = source("src/lib/outbox/outbox-worker.ts");
const domain = source("src/lib/identity/worker-identity-check-domain.ts");
const repository = source("src/lib/identity/worker-identity-check-repository.ts");
const service = source("src/lib/identity/worker-identity-check-service.ts");
const handler = source("src/lib/identity/worker-identity-check-handler.ts");
const runner = source("scripts/run-worker-identity-automated-check-tests.mjs");
const domainTests = source("tests/identity/worker-identity-check-domain.test.mjs");
const platformTests = source("tests/platform/worker-identity-automated-checks.test.mjs");
const migrationTests = source(
  "tests/platform/worker-identity-automated-checks-migration-stack.test.mjs"
);

const checksum = createHash("sha256")
  .update(historicalScanMigration, "utf8")
  .digest("hex");
assert.equal(
  checksum,
  EXPECTED_0013_CHECKSUM,
  "The S4 historical 0013 replay envelope must stay pinned to the exact accepted checksum."
);
for (const marker of [
  EXPECTED_0013_CHECKSUM,
  PREVIOUS_0013_CHECKSUM,
  LEGACY_0013_CHECKSUM,
  "acceptedPreviousChecksums"
]) {
  mustContain(
    migrationEngine,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `Migration repair lineage must retain ${marker}.`
  );
}

assert.equal(
  packageDocument.scripts["check:worker-identity-automated-checks"],
  "node scripts/check-worker-identity-automated-checks.mjs"
);
assert.equal(
  packageDocument.scripts["test:worker-identity-automated-checks"],
  "node scripts/run-worker-identity-automated-check-tests.mjs"
);
for (const aggregate of ["verify:quick", "check"]) {
  mustContain(
    packageDocument.scripts[aggregate],
    /npm run check:worker-identity-automated-checks(?:\s|$)/,
    `${aggregate} must execute the S4 source guard.`
  );
}
for (const aggregate of ["test:integration", "check"]) {
  mustContain(
    packageDocument.scripts[aggregate],
    /npm run test:worker-identity-automated-checks(?:\s|$)/,
    `${aggregate} must execute the S4 runtime acceptance suite.`
  );
}

for (const text of [historicalScanMigration, migration, outboxDomain, outboxWorker]) {
  mustContain(
    text,
    /worker_identity\.automated_checks/,
    "The explicit automated-check outbox job type must remain registered end to end."
  );
}
for (const marker of [
  "worker_identity_check_runs",
  "worker_identity_check_results",
  "document_consistency",
  "face_comparison",
  "liveness",
  "provider_unavailable",
  "platform_outbox_sync_terminal_identity_checks",
  "Automated checks must target the exact current submitted Worker identity version",
  "Automated-check run requires the exact leased outbox job binding"
]) {
  mustContain(
    migration,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S4 migration must retain ${marker}.`
  );
}
mustContain(
  migrationDown,
  /logical\/monotonic/i,
  "S4 rollback must remain monotonic and preserve durable check history."
);

for (const marker of [
  "deterministic_local_test",
  "WorkerIdentityCheckProviderUnavailableError",
  "sandbox_face_requires_human_review",
  "sandbox_liveness_requires_live_provider",
  "appEnvironment === \"development\" || appEnvironment === \"test\""
]) {
  mustContain(
    domain,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S4 provider boundary must retain ${marker}.`
  );
}
mustNotContain(
  domain,
  /verified_identity|identity_verified|automatic(?:ally)?_verified/i,
  "The deterministic adapter must not claim an identity is verified."
);

for (const marker of [
  "scheduleOwn",
  "beginLeasedRun",
  "completeLeasedRun",
  "failProviderUnavailable",
  "manual_review",
  "automated_checks",
  "assertTrustedOutboxLease"
]) {
  mustContain(
    repository,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S4 repository must retain ${marker}.`
  );
}
for (const marker of ["scheduleOwn", "loadOwn"]) {
  mustContain(
    service,
    new RegExp(marker),
    `S4 service must retain ${marker}.`
  );
}
for (const marker of [
  "WorkerIdentityAutomatedCheckHandler",
  "identity_provider_not_configured",
  "identity_check_processing_failed",
  "WorkerIdentityCheckStaleVersionError",
  "return { kind: \"succeeded\" }"
]) {
  mustContain(
    handler,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S4 handler must retain ${marker}.`
  );
}

for (const marker of [
  "worker-identity-check-domain.test.mjs",
  "worker-identity-automated-checks.test.mjs",
  "worker-identity-automated-checks-migration-stack.test.mjs",
  "collectRuntimeSources",
  "HSE_WORKER_IDENTITY_CHECK_RUNTIME_DIST"
]) {
  mustContain(
    runner,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `S4 runner must retain ${marker}.`
  );
}
for (const [text, pattern, label] of [
  [
    domainTests,
    /preview[\s\S]{0,80}production[\s\S]{0,100}fail closed/i,
    "preview/production provider checks fail closed"
  ],
  [
    platformTests,
    /preview[\s\S]{0,80}provider boundary[\s\S]{0,80}fails closed/i,
    "preview provider runtime boundary fails closed"
  ],
  [platformTests, /stale[\s\S]{0,80}job[\s\S]{0,80}drains/i, "stale-job runtime behavior"],
  [
    migrationTests,
    /survive PGlite close and reopen/i,
    "restart persistence coverage"
  ],
  [migrationTests, /historical 0013/i, "historical 0013 replay coverage"]
]) {
  mustContain(
    text,
    pattern,
    `S4 acceptance coverage must retain ${label}.`
  );
}

for (const text of [domain, repository, service, handler, platformTests, migrationTests]) {
  mustNotContain(
    text,
    /src\/app\/(?:worker|company|assessor|verifier|admin|root)\//,
    "S4 must not introduce the S6 browser identity workflow early."
  );
  mustNotContain(
    text,
    /@ts-ignore|@ts-expect-error|\bas any\b|as unknown as/,
    "S4 must not bypass type or security boundaries."
  );
}

console.log(
  "Worker identity S4 automated checks, provider fail-closed boundary, shared outbox binding, stale-job safety, migration lineage and permanent runtime acceptance guard passed."
);
