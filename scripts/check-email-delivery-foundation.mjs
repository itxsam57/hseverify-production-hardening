import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const up = await readFile(
  resolve("database/migrations/0010_email_delivery_foundation.up.sql"),
  "utf8"
);
const down = await readFile(
  resolve("database/migrations/0010_email_delivery_foundation.down.sql"),
  "utf8"
);
const domain = await readFile(
  resolve("src/lib/email-delivery/email-delivery-domain.ts"),
  "utf8"
);
const repository = await readFile(
  resolve("src/lib/email-delivery/email-delivery-repository.ts"),
  "utf8"
);
const adapter = await readFile(
  resolve("src/lib/email-delivery/email-delivery-adapter.ts"),
  "utf8"
);
const handler = await readFile(
  resolve("src/lib/email-delivery/email-delivery-handler.ts"),
  "utf8"
);
const service = await readFile(
  resolve("src/lib/email-delivery/email-delivery-service.ts"),
  "utf8"
);
const outboxDomain = await readFile(
  resolve("src/lib/outbox/outbox-domain.ts"),
  "utf8"
);
const worker = await readFile(resolve("src/lib/outbox/outbox-worker.ts"), "utf8");
const auditDomain = await readFile(
  resolve("src/lib/audit/audit-domain.ts"),
  "utf8"
);
const runtimeRunner = await readFile(
  resolve("scripts/run-email-delivery-runtime-tests.mjs"),
  "utf8"
);
const runtimeTest = await readFile(
  resolve("tests/platform/email-delivery-runtime.test.mjs"),
  "utf8"
);
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));

assert.match(up, /CREATE TABLE IF NOT EXISTS platform_email_deliveries/);
assert.match(up, /CREATE TABLE IF NOT EXISTS platform_email_delivery_attempts/);
assert.match(up, /source_job_id TEXT NOT NULL UNIQUE/);
assert.match(up, /source_outbox_attempt_id TEXT NOT NULL UNIQUE/);
assert.match(up, /recipient_address_hash TEXT NOT NULL/);
assert.match(up, /recipient_role TEXT NOT NULL/);
assert.match(up, /platform_email_delivery_validate_insert/);
assert.match(up, /registered email delivery outbox job/);
assert.match(up, /source_job\.enqueued_by_account_id IS DISTINCT FROM NEW\.recipient_account_id/);
assert.match(up, /memberships\.membership_id = NEW\.membership_id/);
assert.match(up, /memberships\.tenant_id = NEW\.tenant_id/);
assert.match(up, /platform_email_attempt_validate_insert/);
assert.match(up, /currently owned unexpired outbox lease/);
assert.match(up, /platform_email_delivery_guard_update/);
assert.match(up, /platform_email_attempt_guard_update/);
assert.match(up, /BEFORE DELETE ON platform_email_deliveries/);
assert.match(up, /BEFORE DELETE ON platform_email_delivery_attempts/);
assert.match(down, /DROP TABLE IF EXISTS platform_email_delivery_attempts/);
assert.match(down, /DROP TABLE IF EXISTS platform_email_deliveries/);
assert.match(down, /expanded[\s\S]*outbox job type[\s\S]*audit action\/target vocabularies/i);
assert.doesNotMatch(down, /DROP CONSTRAINT IF EXISTS platform_outbox_jobs_job_type_check/);

assert.match(domain, /EMAIL_DELIVERY_TYPES = \["platform\.foundation\.email"\]/);
assert.match(domain, /EMAIL_ADAPTER_KEYS = \["local_test"\]/);
assert.match(domain, /hashEmailRecipientAddress/);
assert.match(domain, /deriveEmailDispatchKey/);
assert.match(domain, /hashProviderReference/);
assert.match(domain, /OUTBOX_MAX_ATTEMPTS/);
assert.doesNotMatch(domain, /https?:\/\//i);

assert.match(outboxDomain, /"email\.delivery\.foundation"/);
assert.match(outboxDomain, /FoundationEmailDeliveryPayload/);
assert.match(outboxDomain, /case "email\.delivery\.foundation"/);
assert.match(outboxDomain, /FORBIDDEN_PAYLOAD_KEY/);

assert.match(repository, /^import "server-only";/);
assert.match(repository, /recipient_account_id = \$1[\s\S]*recipient_role = \$2/);
assert.match(repository, /tenant_id = \$3[\s\S]*membership_id = \$4/);
assert.match(repository, /source_outbox_attempt_id = \$1/);
assert.match(repository, /jobs\.lease_id = \$4[\s\S]*jobs\.worker_id = \$3/);
assert.match(repository, /jobs\.lease_expires_at > CURRENT_TIMESTAMP/);
assert.match(repository, /outbox_attempts\.attempt_number::smallint = \$4/);
assert.match(repository, /ON CONFLICT \(delivery_key\) DO NOTHING/);
assert.match(repository, /ON CONFLICT \(source_outbox_attempt_id\) DO NOTHING/);
assert.doesNotMatch(repository, /export const EMAIL_DELETE/);

assert.match(adapter, /^import "server-only";/);
assert.match(adapter, /LocalTestEmailDeliveryAdapter/);
assert.match(adapter, /environment !== "development"[\s\S]*environment !== "test"/);
assert.match(adapter, /email\.foundation\.retry_once/);
assert.match(adapter, /email\.foundation\.retry_always/);
assert.match(adapter, /email\.foundation\.terminal/);
assert.match(adapter, /provider_unconfigured/);
assert.doesNotMatch(adapter, /\bfetch\s*\(/);
assert.doesNotMatch(adapter, /https?:\/\//i);
assert.doesNotMatch(adapter, /nodemailer|sendgrid|mailgun|resend|smtp/i);

assert.match(handler, /processEmailDeliveryOutboxJob/);
assert.match(handler, /beginAttemptInTransaction/);
assert.match(handler, /finalizeAttemptInTransaction/);
assert.match(handler, /attempt\.kind === "attempt" && attempt\.created/);
assert.match(handler, /preparation\.kind === "already_delivered"/);
assert.match(handler, /preparation\.kind === "already_terminal"/);
assert.match(repository, /const created = Boolean\(inserted\.rows\[0\]\)/);
assert.match(repository, /kind: "already_delivered"/);
assert.match(repository, /kind: "already_terminal"/);
assert.match(handler, /assertTrustedOutboxLease/);
assert.match(handler, /email\.delivery\.attempt\.started/);
assert.match(handler, /email\.delivery\.delivered/);
assert.match(handler, /email\.delivery\.retry_scheduled/);
assert.match(handler, /email\.delivery\.terminal_failed/);
assert.doesNotMatch(handler, /recipientAddress[\s\S]*metadata:/);

assert.match(service, /runRequiredOutboxTransaction/);
assert.match(service, /jobType: "email\.delivery\.foundation"/);
assert.match(service, /queueInTransaction\(database, job\)/);
assert.match(service, /email\.delivery\.queued/);
assert.match(service, /appEnvironment !== "development"[\s\S]*appEnvironment !== "test"/);

assert.match(
  worker,
  /"email\.delivery\.foundation": async \(job, lease\) =>\s*processEmailDeliveryOutboxJob\(job, lease\)/
);
assert.doesNotMatch(
  worker,
  /"email\.delivery\.foundation": processEmailDeliveryOutboxJob/
);
assert.match(worker, /handler\(claimed\.job, claimed\.lease\)/);
assert.match(auditDomain, /"email\.delivery\.queued"/);
assert.match(auditDomain, /"email_delivery"/);

// Runtime proof executes the real already-typechecked server modules. It must not
// introduce a second standalone tsconfig/compiler-resolution universe.
assert.match(runtimeRunner, /ts\.transpileModule/);
assert.match(runtimeRunner, /SOURCE_FILES = Object\.freeze/);
assert.match(runtimeRunner, /source\.replace\(\/\^import \"server-only\"/);
assert.match(runtimeRunner, /Runtime test must inject a database client/);
assert.match(runtimeRunner, /Runtime test must inject the local\/test adapter environment/);
assert.doesNotMatch(runtimeRunner, /tsconfig\.email-delivery-runtime-tests/);
assert.doesNotMatch(runtimeRunner, /baseUrl/);
assert.doesNotMatch(runtimeRunner, /--conditions=react-server/);
assert.match(runtimeTest, /DatabaseOutboxRepository/);
assert.match(runtimeTest, /DatabaseEmailDeliveryRepository/);
assert.match(runtimeTest, /LocalTestEmailDeliveryAdapter/);
assert.match(runtimeTest, /processEmailDeliveryOutboxJob/);
assert.match(runtimeTest, /durably delivered email must not dispatch twice/);
assert.match(runtimeTest, /email\.foundation\.retry_once/);
assert.match(runtimeTest, /email\.foundation\.retry_always/);
assert.match(runtimeTest, /attemptNumber <= 5/);
assert.match(runtimeTest, /platform_email_delivery_attempts/);
assert.match(runtimeTest, /platform_audit_events/);
assert.match(runtimeTest, /survive persistent PGlite close and reopen/);
assert.match(runtimeTest, /persisted\.includes\(email\.toLowerCase\(\)\), false/);

assert.equal(
  packageJson.scripts["check:email-delivery"],
  "node scripts/check-email-delivery-foundation.mjs"
);
assert.equal(
  packageJson.scripts["test:email-delivery"],
  "node scripts/run-email-delivery-tests.mjs"
);
assert.equal(
  packageJson.scripts["test:email-delivery-runtime"],
  "node scripts/run-email-delivery-runtime-tests.mjs"
);
assert.match(packageJson.scripts.check, /check:email-delivery/);
assert.match(packageJson.scripts.check, /test:email-delivery-platform/);
assert.match(packageJson.scripts.check, /test:email-delivery-runtime/);
assert.match(packageJson.scripts["test:integration"], /test:email-delivery-runtime/);

console.log(
  "Durable email queue, lease-safe attempt history, real local/test delivery path and scoped read contracts passed."
);
