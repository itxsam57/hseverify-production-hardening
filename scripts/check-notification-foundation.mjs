import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const up = await readFile(
  resolve("database/migrations/0009_persisted_notifications.up.sql"),
  "utf8"
);
const down = await readFile(
  resolve("database/migrations/0009_persisted_notifications.down.sql"),
  "utf8"
);
const domain = await readFile(
  resolve("src/lib/notifications/notification-domain.ts"),
  "utf8"
);
const repository = await readFile(
  resolve("src/lib/notifications/notification-repository.ts"),
  "utf8"
);
const service = await readFile(
  resolve("src/lib/notifications/notification-service.ts"),
  "utf8"
);
const projector = await readFile(
  resolve("src/lib/notifications/notification-projector.ts"),
  "utf8"
);
const worker = await readFile(resolve("src/lib/outbox/outbox-worker.ts"), "utf8");
const actions = await readFile(resolve("src/app/notifications/actions.ts"), "utf8");
const center = await readFile(
  resolve("src/components/notifications/notification-center.tsx"),
  "utf8"
);
const workerShell = await readFile(
  resolve("src/components/worker/worker-shell.tsx"),
  "utf8"
);
const roleShell = await readFile(
  resolve("src/components/auth/role-portal-shell.tsx"),
  "utf8"
);
const workerDashboardRepository = await readFile(
  resolve("src/lib/worker/dashboard-repository.ts"),
  "utf8"
);
const workerDashboardPage = await readFile(
  resolve("src/app/worker/(portal)/dashboard/page.tsx"),
  "utf8"
);
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));

assert.match(up, /CREATE TABLE IF NOT EXISTS platform_notifications/);
assert.match(up, /source_job_id TEXT NOT NULL UNIQUE/);
assert.match(up, /projection_key TEXT NOT NULL UNIQUE/);
assert.match(up, /recipient_account_id TEXT NOT NULL/);
assert.match(up, /recipient_role TEXT NOT NULL/);
assert.match(up, /platform_notification_validate_projection/);
assert.match(up, /notification must originate from a registered notification outbox job/);
assert.match(up, /source_job\.enqueued_by_account_id IS DISTINCT FROM NEW\.recipient_account_id/);
assert.match(up, /memberships\.membership_id = NEW\.membership_id/);
assert.match(up, /memberships\.tenant_id = NEW\.tenant_id/);
assert.match(up, /platform_notification_guard_update/);
assert.match(up, /OLD\.read_at IS NOT NULL OR NEW\.read_at IS NULL/);
assert.match(up, /NEW\.read_at := CURRENT_TIMESTAMP/);
assert.match(up, /BEFORE DELETE ON platform_notifications/);
assert.match(down, /DROP TABLE IF EXISTS platform_notifications/);
assert.match(down, /expanded[\s\S]*outbox job type[\s\S]*audit action\/target vocabularies/i);
assert.doesNotMatch(down, /DROP CONSTRAINT IF EXISTS platform_outbox_jobs_job_type_check/);

assert.match(domain, /NOTIFICATION_TYPES = \["platform\.foundation\.ready"\]/);
assert.match(domain, /NOTIFICATION_TARGETS = \["portal\.dashboard"\]/);
assert.match(domain, /ROLE_HOME_PATHS\[input\.role\]/);
assert.match(domain, /notificationListPath/);
assert.doesNotMatch(domain, /https?:\/\//i);

assert.match(repository, /^import "server-only";/);
assert.match(repository, /recipient_account_id = \$1[\s\S]*recipient_role = \$2/);
assert.match(repository, /tenant_id = \$3[\s\S]*membership_id = \$4/);
assert.match(repository, /NOTIFICATION_SESSION_GUARD_SQL/);
assert.match(repository, /NOTIFICATION_COMPANY_SCOPE_GUARD_SQL/);
assert.match(repository, /ON CONFLICT \(projection_key\) DO NOTHING/);
assert.doesNotMatch(repository, /export const NOTIFICATION_DELETE_SQL/);

assert.match(projector, /projectInTransaction\(transaction, job\)/);
assert.match(projector, /notification_recipient_unavailable/);
assert.match(projector, /notification\.projected/);
assert.match(
  worker,
  /"notification\.portal\.foundation": async \(job\) =>\s*projectNotificationOutboxJob\(job\)/
);
assert.doesNotMatch(
  worker,
  /"notification\.portal\.foundation": projectNotificationOutboxJob/
);
assert.doesNotMatch(worker, /projectNotificationOutboxJob\(job,\s*lease\)/);

assert.match(service, /runRequiredOutboxTransaction/);
assert.match(service, /processNextOutboxJob/);
assert.match(service, /createIdentifier\("notification_fixture"\)/);
assert.match(service, /foundation-notification:\$\{principal\.accountId\}:\$\{principal\.activeRole\}:\$\{fixtureRef\}/);
assert.match(service, /payload: \{ fixtureRef \}/);
assert.match(service, /environment\.appEnvironment === "production"/);
assert.match(service, /notification\.read/);
assert.match(service, /notification\.deep_link\.denied/);
assert.match(service, /resolveNotificationHref/);
assert.match(service, /repository\.unreadCountForPrincipal\(principal\)/);
assert.doesNotMatch(service, /\b(role|tenantId|membershipId|href|target)\s*:\s*formData/);

assert.match(actions, /formText\(formData, "notificationId"\)/);
assert.doesNotMatch(actions, /formText\(formData, "(role|tenantId|membershipId|href|target)"\)/);
assert.match(actions, /redirect\(result\.href\)/);

assert.match(center, /getNotificationCenter\(role\)/);
assert.match(center, /\{ notifications, unreadCount \} = projection/);
assert.doesNotMatch(center, /notifications\.filter\([^)]*readAt/);
assert.match(workerShell, /<NotificationBell/);
assert.match(roleShell, /<NotificationBell/);
assert.match(workerDashboardPage, /getNotificationMenu\("worker"\)/);
assert.doesNotMatch(workerDashboardRepository, /notifications\s*:/);
assert.doesNotMatch(workerDashboardRepository, /Assessment assigned[\s\S]*notification/i);

for (const role of ["worker", "company", "assessor", "verifier", "admin", "root"]) {
  const page = await readFile(
    resolve(`src/app/${role}/(portal)/notifications/page.tsx`),
    "utf8"
  );
  const loading = await readFile(
    resolve(`src/app/${role}/(portal)/notifications/loading.tsx`),
    "utf8"
  );
  const error = await readFile(
    resolve(`src/app/${role}/(portal)/notifications/error.tsx`),
    "utf8"
  );
  assert.match(page, new RegExp(`role=["']${role}["']`));
  assert.match(page, /NotificationCenter/);
  assert.match(loading, /NotificationLoading/);
  assert.match(error, /NotificationError/);
}

assert.equal(
  packageJson.scripts["check:notifications"],
  "node scripts/check-notification-foundation.mjs"
);
assert.match(packageJson.scripts.check, /check:notifications/);
assert.match(packageJson.scripts.check, /test:notification-platform/);

console.log("Persisted notification, role-safe deep-link and shared-shell source contracts passed.");
