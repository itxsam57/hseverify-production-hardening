import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve("src", "lib");

async function source(path) {
  return readFile(resolve(path), "utf8");
}

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(path));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function mustContain(text, pattern, message) {
  assert.match(text, pattern, message);
}

function mustNotContain(text, pattern, message) {
  assert.doesNotMatch(text, pattern, message);
}

const [
  auditRepository,
  outboxRepository,
  outboxWorker,
  notificationRepository,
  notificationService,
  notificationDomain,
  emailRepository,
  emailHandler,
  emailAdapter,
  emailDomain,
  auditMigration,
  outboxMigration,
  notificationMigration,
  emailMigration,
  packageJson
] = await Promise.all([
  source("src/lib/audit/audit-repository.ts"),
  source("src/lib/outbox/outbox-repository.ts"),
  source("src/lib/outbox/outbox-worker.ts"),
  source("src/lib/notifications/notification-repository.ts"),
  source("src/lib/notifications/notification-service.ts"),
  source("src/lib/notifications/notification-domain.ts"),
  source("src/lib/email-delivery/email-delivery-repository.ts"),
  source("src/lib/email-delivery/email-delivery-handler.ts"),
  source("src/lib/email-delivery/email-delivery-adapter.ts"),
  source("src/lib/email-delivery/email-delivery-domain.ts"),
  source("database/migrations/0007_platform_audit_foundation.up.sql"),
  source("database/migrations/0008_transactional_outbox_jobs.up.sql"),
  source("database/migrations/0009_persisted_notifications.up.sql"),
  source("database/migrations/0010_email_delivery_foundation.up.sql"),
  source("package.json")
]);

mustContain(auditMigration, /CREATE TABLE IF NOT EXISTS platform_audit_events/i,
  "M1.05 must retain one canonical immutable audit store.");
mustContain(outboxMigration, /CREATE TABLE IF NOT EXISTS platform_outbox_jobs/i,
  "M1.05 must retain one canonical outbox job store.");
mustContain(notificationMigration, /CREATE TABLE IF NOT EXISTS platform_notifications/i,
  "M1.05 must retain one canonical persisted notification store.");
mustContain(emailMigration, /CREATE TABLE IF NOT EXISTS platform_email_deliveries/i,
  "M1.05 must retain one canonical email-delivery store.");

mustContain(auditRepository,
  /FROM platform_audit_events[\s\S]*WHERE actor_tenant_id = \$1/,
  "Tenant audit reads must be SQL-scoped before rows leave the database.");
mustContain(outboxRepository,
  /FROM platform_outbox_jobs[\s\S]*WHERE tenant_id = \$1/,
  "Tenant outbox reads must be SQL-scoped before rows leave the database.");
mustContain(notificationRepository,
  /recipient_account_id = \$1[\s\S]*recipient_role = \$2[\s\S]*tenant_id = \$3[\s\S]*membership_id = \$4/,
  "Notification reads must bind recipient, role and Company scope directly in SQL.");
mustContain(emailRepository,
  /recipient_account_id = \$1[\s\S]*recipient_role = \$2[\s\S]*tenant_id = \$3[\s\S]*membership_id = \$4/,
  "Email-delivery reads must bind recipient, role and Company scope directly in SQL.");

mustContain(outboxRepository, /FOR UPDATE SKIP LOCKED/,
  "Outbox concurrency must keep SKIP LOCKED claim semantics.");
mustContain(outboxRepository, /lease_expires_at > CURRENT_TIMESTAMP/,
  "Outbox completion/retry paths must require an unexpired lease.");
mustContain(emailRepository, /jobs\.lease_expires_at > CURRENT_TIMESTAMP/,
  "Email attempt start/finalization must require the live outbox lease.");
mustContain(emailHandler, /preparation\.kind === "already_delivered"[\s\S]*kind: "succeeded"/,
  "Durably delivered email state must short-circuit redispatch.");
mustContain(emailHandler, /preparation\.kind === "already_terminal"[\s\S]*kind: "terminal"/,
  "Durably terminal email state must short-circuit redispatch.");

mustContain(notificationRepository, /ON CONFLICT \(projection_key\) DO NOTHING/,
  "Notification projection must remain idempotent.");
mustContain(emailRepository, /ON CONFLICT \(delivery_key\) DO NOTHING/,
  "Email queue projection must remain idempotent.");
mustContain(outboxRepository, /ON CONFLICT \(job_type, idempotency_key\) DO NOTHING/,
  "Outbox enqueue must remain idempotent.");

mustContain(notificationService, /findForPrincipal\([\s\S]*resolveNotificationHref\(/,
  "Notification opening must reauthorize the stored notification before fixed server-side href resolution.");
mustContain(notificationDomain, /portal\.dashboard/,
  "The accepted role-safe deep-link target registry must remain fixed.");
mustNotContain(notificationDomain, /https?:\/\//,
  "Notification targets must not become arbitrary network URLs.");

mustContain(emailDomain, /EMAIL_ADAPTER_KEYS = \["local_test"\] as const/,
  "The accepted email provider authority must remain exactly the local/test adapter.");
mustContain(emailAdapter, /local_test/,
  "The accepted local/test email adapter must remain explicit.");
mustNotContain(emailAdapter, /\bfetch\s*\(/,
  "The local/test email adapter must not perform network fetches.");
mustNotContain(emailAdapter, /https?:\/\//,
  "The local/test email adapter must not contain network endpoints.");
mustNotContain(emailDomain, /\b(?:smtp|sendgrid|mailgun|ses|postmark)\b/i,
  "Subunit 5 must not pull a named live provider into the email domain.");

mustNotContain(emailMigration,
  /recipient_(email|address)\s+(TEXT|VARCHAR)/i,
  "Plaintext recipient addresses must not be persisted in the email-delivery schema.");
mustContain(emailMigration, /recipient_address_hash TEXT NOT NULL/,
  "Email delivery must retain only the accepted recipient-address fingerprint.");

mustContain(outboxWorker,
  /"notification\.portal\.foundation"[\s\S]*projectNotificationOutboxJob\(job\)/,
  "Notification work must remain in the fixed outbox handler registry.");
mustContain(outboxWorker,
  /"email\.delivery\.foundation"[\s\S]*processEmailDeliveryOutboxJob\(job, lease\)/,
  "Email work must remain in the fixed outbox handler registry with the trusted lease.");
mustNotContain(outboxWorker, /import\s*\([^)]*job|new Function|eval\s*\(/,
  "The shared worker must not dynamically select executable handlers.");

const m105Directories = [
  join(ROOT, "audit"),
  join(ROOT, "outbox"),
  join(ROOT, "notifications"),
  join(ROOT, "email-delivery")
];
const m105Files = (await Promise.all(m105Directories.map(collectTypeScriptFiles))).flat();
for (const path of m105Files) {
  const text = await readFile(path, "utf8");
  mustNotContain(text, /\bas any\b|@ts-ignore|@ts-expect-error/,
    `${path} must not bypass the accepted type/security contracts.`);
}

mustContain(packageJson, /"test:m1-05-final"/,
  "The final combined M1.05 regression suite must remain wired into package scripts.");
mustContain(packageJson, /m1-05-final-acceptance\.test\.mjs/,
  "The final M1.05 isolation/integrity/persistence suite must remain wired into the final gate.");
mustContain(packageJson, /m1-05-final-concurrency\.test\.mjs/,
  "The mixed notification/email concurrency and crash-recovery proof must remain wired into the final gate.");
mustContain(packageJson, /m1-05-final-role-matrix\.test\.mjs/,
  "The six-role notification/email recipient isolation matrix must remain wired into the final gate.");
mustContain(packageJson, /"check:m1-05-final"/,
  "The final M1.05 source guard must remain wired into package scripts.");

console.log("M1.05 final source/authority guard passed.");
