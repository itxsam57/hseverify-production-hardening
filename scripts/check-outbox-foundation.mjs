import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

const up = await readFile(
  resolve("database/migrations/0008_transactional_outbox_jobs.up.sql"),
  "utf8"
);
const down = await readFile(
  resolve("database/migrations/0008_transactional_outbox_jobs.down.sql"),
  "utf8"
);
const notificationUp = await readFile(
  resolve("database/migrations/0009_persisted_notifications.up.sql"),
  "utf8"
);
const domain = await readFile(resolve("src/lib/outbox/outbox-domain.ts"), "utf8");
const repository = await readFile(
  resolve("src/lib/outbox/outbox-repository.ts"),
  "utf8"
);
const service = await readFile(
  resolve("src/lib/outbox/outbox-service.ts"),
  "utf8"
);
const transactionDomain = await readFile(
  resolve("src/lib/outbox/outbox-transaction-domain.ts"),
  "utf8"
);
const worker = await readFile(
  resolve("src/lib/outbox/outbox-worker.ts"),
  "utf8"
);
const concurrency = await readFile(
  resolve("tests/platform/outbox-concurrency.test.mjs"),
  "utf8"
);
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));

assert.match(up, /CREATE TABLE IF NOT EXISTS platform_outbox_jobs/);
assert.match(up, /CREATE TABLE IF NOT EXISTS platform_outbox_job_attempts/);
assert.match(up, /UNIQUE \(job_type, idempotency_key\)/);
assert.match(up, /status IN \('pending', 'leased', 'retry_wait', 'succeeded', 'terminal_failed'\)/);
assert.match(up, /BEFORE DELETE ON platform_outbox_jobs/);
assert.match(up, /BEFORE DELETE ON platform_outbox_job_attempts/);
assert.match(down, /DROP TABLE IF EXISTS platform_outbox_job_attempts/);
assert.match(down, /DROP TABLE IF EXISTS platform_outbox_jobs/);
assert.match(notificationUp, /'notification\.portal\.foundation'/);

assert.match(repository, /^import "server-only";/);
assert.match(service, /^import "server-only";/);
assert.match(worker, /^import "server-only";/);
assert.match(repository, /FOR UPDATE SKIP LOCKED/);
assert.match(repository, /lease_expires_at > CURRENT_TIMESTAMP/);
assert.match(repository, /OUTBOX_TERMINAL_EXPIRED_JOB_SQL/);
assert.match(repository, /while \(true\)/);
assert.match(repository, /normalizeOutboxJobReference/);
assert.match(repository, /WHERE tenant_id = \$1[\s\S]*job_id = \$2/);
assert.match(repository, /new DatabaseAuditRepository\(Promise\.resolve\(input\.database\)\)/);
assert.doesNotMatch(repository, /export const OUTBOX_DELETE_SQL/);

assert.match(transactionDomain, /requiredEnqueueCalls/);
assert.match(transactionDomain, /throw new RequiredOutboxMissingError\(\)/);
assert.match(transactionDomain, /input\.executor\.transaction/);
assert.match(service, /runRequiredOutboxTransactionCore/);
assert.doesNotMatch(
  service,
  /\b(jobType|businessKey|handler|workerId|leaseId)\s*:\s*formData/
);

assert.match(domain, /"platform\.foundation\.noop"/);
assert.match(domain, /"notification\.portal\.foundation"/);
assert.match(domain, /deriveOutboxIdempotencyKey/);
assert.match(repository, /tenant:\$\{actor\.tenantId\}/);
assert.match(repository, /account:\$\{actor\.accountId\}/);
assert.match(domain, /FORBIDDEN_PAYLOAD_KEY/);
assert.match(domain, /OUTBOX_RETRY_DELAYS_SECONDS/);
assert.match(worker, /const HANDLERS/);
assert.match(worker, /"platform\.foundation\.noop"/);
assert.match(worker, /"notification\.portal\.foundation"/);
assert.match(worker, /projectNotificationOutboxJob/);
assert.doesNotMatch(worker, /\b(import|require)\s*\(\s*claimed\.job/);
assert.doesNotMatch(worker, /\beval\s*\(/);
assert.doesNotMatch(worker, /new Function/);

assert.match(concurrency, /Promise\.all/);
assert.match(concurrency, /new Set\(claims\.map/);
assert.equal(packageJson.scripts["check:outbox"], "node scripts/check-outbox-foundation.mjs");
assert.equal(packageJson.scripts["test:outbox"], "node scripts/run-outbox-tests.mjs");
assert.equal(
  packageJson.scripts["test:outbox-platform"],
  "node --test tests/platform/outbox-foundation.test.mjs tests/platform/outbox-concurrency.test.mjs tests/platform/outbox-migration-stack.test.mjs"
);
assert.match(packageJson.scripts.check, /check:outbox/);
assert.match(packageJson.scripts.check, /test:outbox-platform/);

for (const directory of ["src/app", "src/components"]) {
  for (const file of await filesUnder(resolve(directory))) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /from ["'][^"']*\/outbox\/outbox-(domain|repository|worker)["']/,
      `${file} must not import raw outbox authority`
    );
  }
}

console.log("Transactional outbox source, migration, worker and isolation contracts passed.");
