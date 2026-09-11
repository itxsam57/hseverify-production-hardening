import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationStatus
} from "../../scripts/lib/migrations.mjs";

const NOW = "2026-08-09T14:00:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";
const COMPLETE_MIGRATIONS = (await listMigrations()).map(
  (migration) => migration.id
);

function environment(releaseSha, pgliteDataDir = "memory://") {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir,
    releaseSha,
    sessionSecret: "m1-05-final-session-secret-with-at-least-32-characters",
    authPepper: "m1-05-final-auth-pepper-with-at-least-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

function opaque(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function extractSql(source, name) {
  const prefix = `export const ${name} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${name} must be extractable`);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  assert.notEqual(end, -1, `${name} SQL terminator must be extractable`);
  return source.slice(contentStart, end);
}

async function contracts() {
  const [audit, outbox, notification, email] = await Promise.all([
    readFile(resolve("src/lib/audit/audit-repository.ts"), "utf8"),
    readFile(resolve("src/lib/outbox/outbox-repository.ts"), "utf8"),
    readFile(resolve("src/lib/notifications/notification-repository.ts"), "utf8"),
    readFile(resolve("src/lib/email-delivery/email-delivery-repository.ts"), "utf8")
  ]);
  return {
    auditAppend: extractSql(audit, "AUDIT_APPEND_SQL"),
    auditTenantList: extractSql(audit, "AUDIT_TENANT_LIST_SQL"),
    auditTenantFind: extractSql(audit, "AUDIT_TENANT_FIND_SQL"),
    outboxEnqueue: extractSql(outbox, "OUTBOX_ENQUEUE_SQL"),
    outboxTenantList: extractSql(outbox, "OUTBOX_TENANT_LIST_SQL"),
    outboxTenantFind: extractSql(outbox, "OUTBOX_TENANT_FIND_SQL"),
    notificationInsert: extractSql(notification, "NOTIFICATION_INSERT_SQL"),
    notificationList: extractSql(notification, "NOTIFICATION_LIST_SQL"),
    notificationFind: extractSql(notification, "NOTIFICATION_FIND_SQL"),
    notificationMarkRead: extractSql(notification, "NOTIFICATION_MARK_READ_SQL"),
    notificationSessionGuard: extractSql(notification, "NOTIFICATION_SESSION_GUARD_SQL"),
    notificationCompanyGuard: extractSql(notification, "NOTIFICATION_COMPANY_SCOPE_GUARD_SQL"),
    emailQueue: extractSql(email, "EMAIL_QUEUE_SQL"),
    emailList: extractSql(email, "EMAIL_LIST_SQL"),
    emailFind: extractSql(email, "EMAIL_FIND_SCOPED_SQL"),
    emailSessionGuard: extractSql(email, "EMAIL_SESSION_GUARD_SQL"),
    emailCompanyGuard: extractSql(email, "EMAIL_COMPANY_SCOPE_GUARD_SQL")
  };
}

async function insertCompany(database, suffix, character) {
  const accountId = `account_m105_company_${suffix}`;
  const tenantId = opaque("tenant", character);
  const membershipId = opaque("membership", character);
  const sessionId = `session_m105_company_${suffix}`;
  const email = `m105-${suffix}@example.com`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `M1.05 Company ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `M1.05 Tenant ${suffix}`, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, hash(`token-${suffix}`), hash(`csrf-${suffix}`), NOW, EXPIRES]
  );

  return { accountId, tenantId, membershipId, sessionId, email };
}

async function insertWorker(database, suffix) {
  const accountId = `account_m105_worker_${suffix}`;
  const sessionId = `session_m105_worker_${suffix}`;
  const email = `m105-worker-${suffix}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, email, `M1.05 Worker ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'worker', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, hash(`token-${suffix}`), hash(`csrf-${suffix}`), NOW, EXPIRES]
  );
  return { accountId, sessionId, email };
}

async function insertJob(database, input) {
  const jobId = opaque("job", input.character);
  const payload = input.jobType === "notification.portal.foundation"
    ? { fixtureRef: `fixture_${input.character}` }
    : input.jobType === "email.delivery.foundation"
      ? { fixtureRef: `email.foundation.success.${input.character}` }
      : { probeRef: `probe_${input.character}` };
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, $2, 1, $3, $4::jsonb, $5, $6, $7, $8)`,
    [
      jobId,
      input.jobType,
      hash(`${input.jobType}:${input.character}:${input.accountId}`),
      JSON.stringify(payload),
      input.accountId,
      input.role,
      input.tenantId ?? null,
      input.membershipId ?? null
    ]
  );
  return jobId;
}

async function insertNotification(database, sql, input) {
  const projectionKey = hash(`notification:${input.character}:${input.accountId}`);
  const result = await database.query(sql, [
    opaque("notification", input.character),
    "platform.foundation.ready",
    1,
    input.jobId,
    projectionKey,
    input.accountId,
    input.role,
    input.tenantId ?? null,
    input.membershipId ?? null,
    "Notification foundation ready",
    "This persisted notification verifies the current portal notification channel.",
    JSON.stringify({ fixtureRef: `fixture_${input.character}` }),
    "portal.dashboard",
    null
  ]);
  return { row: result.rows[0] ?? null, projectionKey };
}

async function insertDelivery(database, sql, input) {
  const deliveryKey = hash(`delivery:${input.character}:${input.accountId}`);
  const result = await database.query(sql, [
    opaque("email_delivery", input.character),
    1,
    input.jobId,
    deliveryKey,
    input.accountId,
    input.role,
    input.tenantId ?? null,
    input.membershipId ?? null,
    hash(input.email)
  ]);
  return { row: result.rows[0] ?? null, deliveryKey };
}

async function insertAudit(database, sql, input) {
  const eventId = opaque("audit", input.character);
  const result = await database.query(sql, [
    eventId,
    input.accountId,
    input.role,
    input.tenantId ?? null,
    input.membershipId ?? null,
    "authorization.access.denied",
    "denied",
    "permission_denied",
    "resource",
    `resource_${input.character}`,
    null,
    JSON.stringify({ suite: "m1-05-final", marker: input.character })
  ]);
  return result.rows[0];
}

test("combined M1.05 tenant, role, session and revocation isolation is non-enumerating while history remains durable", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(environment("m1-05-final-isolation"));
  try {
    const applied = await applyPendingMigrations(database, "m1-05-final-isolation");
    assert.deepEqual(applied, COMPLETE_MIGRATIONS);

    const companyA = await insertCompany(database, "a", "A");
    const companyB = await insertCompany(database, "b", "B");

    const notificationJobA = await insertJob(database, {
      character: "C", jobType: "notification.portal.foundation", role: "company", ...companyA
    });
    const notificationJobB = await insertJob(database, {
      character: "D", jobType: "notification.portal.foundation", role: "company", ...companyB
    });
    const notificationA = await insertNotification(database, sql.notificationInsert, {
      character: "C", jobId: notificationJobA, role: "company", ...companyA
    });
    const notificationB = await insertNotification(database, sql.notificationInsert, {
      character: "D", jobId: notificationJobB, role: "company", ...companyB
    });
    assert.ok(notificationA.row);
    assert.ok(notificationB.row);

    const emailJobA = await insertJob(database, {
      character: "E", jobType: "email.delivery.foundation", role: "company", ...companyA
    });
    const emailJobB = await insertJob(database, {
      character: "F", jobType: "email.delivery.foundation", role: "company", ...companyB
    });
    const deliveryA = await insertDelivery(database, sql.emailQueue, {
      character: "E", jobId: emailJobA, role: "company", ...companyA
    });
    const deliveryB = await insertDelivery(database, sql.emailQueue, {
      character: "F", jobId: emailJobB, role: "company", ...companyB
    });
    assert.ok(deliveryA.row);
    assert.ok(deliveryB.row);

    const auditA = await insertAudit(database, sql.auditAppend, {
      character: "G", role: "company", ...companyA
    });
    const auditB = await insertAudit(database, sql.auditAppend, {
      character: "H", role: "company", ...companyB
    });

    const auditListA = await database.query(sql.auditTenantList, [companyA.tenantId, null, 50]);
    assert.ok(auditListA.rows.some((row) => row.audit_event_id === auditA.audit_event_id));
    assert.equal(auditListA.rows.some((row) => row.audit_event_id === auditB.audit_event_id), false);
    const auditCross = await database.query(sql.auditTenantFind, [companyA.tenantId, auditB.audit_event_id]);
    assert.equal(auditCross.rows.length, 0);

    const outboxListA = await database.query(sql.outboxTenantList, [companyA.tenantId, null, 50]);
    assert.ok(outboxListA.rows.some((row) => row.job_id === notificationJobA));
    assert.ok(outboxListA.rows.some((row) => row.job_id === emailJobA));
    assert.equal(outboxListA.rows.some((row) => row.job_id === notificationJobB), false);
    const outboxCross = await database.query(sql.outboxTenantFind, [companyA.tenantId, notificationJobB]);
    assert.equal(outboxCross.rows.length, 0);

    const notificationListA = await database.query(sql.notificationList, [
      companyA.accountId, "company", companyA.tenantId, companyA.membershipId, null, 50
    ]);
    assert.deepEqual(notificationListA.rows.map((row) => row.notification_id), [notificationA.row.notification_id]);
    const notificationCross = await database.query(sql.notificationFind, [
      notificationB.row.notification_id,
      companyA.accountId,
      "company",
      companyA.tenantId,
      companyA.membershipId
    ]);
    const notificationWrongRole = await database.query(sql.notificationFind, [
      notificationA.row.notification_id,
      companyA.accountId,
      "worker",
      null,
      null
    ]);
    assert.equal(notificationCross.rows.length, 0);
    assert.equal(notificationWrongRole.rows.length, 0);

    const emailListA = await database.query(sql.emailList, [
      companyA.accountId, "company", companyA.tenantId, companyA.membershipId, null, 50
    ]);
    assert.deepEqual(emailListA.rows.map((row) => row.delivery_id), [deliveryA.row.delivery_id]);
    const emailCross = await database.query(sql.emailFind, [
      deliveryB.row.delivery_id,
      companyA.accountId,
      "company",
      companyA.tenantId,
      companyA.membershipId
    ]);
    const emailWrongRole = await database.query(sql.emailFind, [
      deliveryA.row.delivery_id,
      companyA.accountId,
      "worker",
      null,
      null
    ]);
    assert.equal(emailCross.rows.length, 0);
    assert.equal(emailWrongRole.rows.length, 0);

    const notificationSessionBefore = await database.query(sql.notificationSessionGuard, [
      companyA.sessionId, companyA.accountId, "company"
    ]);
    const emailSessionBefore = await database.query(sql.emailSessionGuard, [
      companyA.sessionId, companyA.accountId, "company"
    ]);
    assert.equal(notificationSessionBefore.rows.length, 1);
    assert.equal(emailSessionBefore.rows.length, 1);

    const continuityAccountId = "account_m105_company_a_continuity";
    const continuityMembershipId = opaque("membership", "T");
    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         email_verified_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
      [continuityAccountId, "m105-a-continuity@example.com", "M1.05 Company a continuity owner", NOW]
    );
    await database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'company', $2)`,
      [continuityAccountId, NOW]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_by_account_id,
         created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
      [continuityMembershipId, companyA.tenantId, continuityAccountId, companyA.accountId, NOW]
    );

    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'revoked', revoked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE membership_id = $1`,
      [companyA.membershipId]
    );
    const notificationCompanyAfter = await database.query(sql.notificationCompanyGuard, [
      companyA.membershipId, companyA.tenantId, companyA.accountId
    ]);
    const emailCompanyAfter = await database.query(sql.emailCompanyGuard, [
      companyA.membershipId, companyA.tenantId, companyA.accountId
    ]);
    assert.equal(notificationCompanyAfter.rows.length, 0);
    assert.equal(emailCompanyAfter.rows.length, 0);

    await database.query(
      `UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP,
           revocation_reason = 'm1_05_final_acceptance'
       WHERE session_id = $1`,
      [companyA.sessionId]
    );
    const notificationSessionAfter = await database.query(sql.notificationSessionGuard, [
      companyA.sessionId, companyA.accountId, "company"
    ]);
    const emailSessionAfter = await database.query(sql.emailSessionGuard, [
      companyA.sessionId, companyA.accountId, "company"
    ]);
    assert.equal(notificationSessionAfter.rows.length, 0);
    assert.equal(emailSessionAfter.rows.length, 0);

    const durableHistory = await Promise.all([
      database.query("SELECT audit_event_id FROM platform_audit_events WHERE audit_event_id = $1", [auditA.audit_event_id]),
      database.query("SELECT job_id FROM platform_outbox_jobs WHERE job_id = $1", [notificationJobA]),
      database.query("SELECT notification_id FROM platform_notifications WHERE notification_id = $1", [notificationA.row.notification_id]),
      database.query("SELECT delivery_id FROM platform_email_deliveries WHERE delivery_id = $1", [deliveryA.row.delivery_id])
    ]);
    for (const result of durableHistory) assert.equal(result.rows.length, 1);
  } finally {
    await database.close();
  }
});

test("combined M1.05 atomicity, idempotency, immutability and secret-minimization contracts hold together", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(environment("m1-05-final-integrity"));
  try {
    await applyPendingMigrations(database, "m1-05-final-integrity");
    const worker = await insertWorker(database, "integrity");
    const originalName = "M1.05 Worker integrity";

    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.query(
          "UPDATE auth_accounts SET display_name = 'must rollback' WHERE account_id = $1",
          [worker.accountId]
        );
        await transaction.query(sql.outboxEnqueue, [
          opaque("job", "I"),
          "platform.foundation.noop",
          1,
          hash("atomic-rollback"),
          JSON.stringify({ probeRef: "probe_I" }),
          worker.accountId,
          "worker",
          null,
          null
        ]);
        throw new Error("force combined rollback");
      }),
      /force combined rollback/
    );
    const rolledBackAccount = await database.query(
      "SELECT display_name FROM auth_accounts WHERE account_id = $1",
      [worker.accountId]
    );
    assert.equal(rolledBackAccount.rows[0].display_name, originalName);
    const rolledBackJob = await database.query(
      "SELECT job_id FROM platform_outbox_jobs WHERE idempotency_key = $1",
      [hash("atomic-rollback")]
    );
    assert.equal(rolledBackJob.rows.length, 0);

    const committedJob = await database.transaction(async (transaction) => {
      await transaction.query(
        "UPDATE auth_accounts SET display_name = 'committed core state' WHERE account_id = $1",
        [worker.accountId]
      );
      return transaction.query(sql.outboxEnqueue, [
        opaque("job", "J"),
        "platform.foundation.noop",
        1,
        hash("atomic-commit"),
        JSON.stringify({ probeRef: "probe_J" }),
        worker.accountId,
        "worker",
        null,
        null
      ]);
    });
    assert.equal(committedJob.rows.length, 1);

    const duplicateOutbox = await database.query(sql.outboxEnqueue, [
      opaque("job", "K"),
      "platform.foundation.noop",
      1,
      hash("atomic-commit"),
      JSON.stringify({ probeRef: "probe_J" }),
      worker.accountId,
      "worker",
      null,
      null
    ]);
    assert.equal(duplicateOutbox.rows.length, 0);

    const notificationJob = await insertJob(database, {
      character: "L", jobType: "notification.portal.foundation", accountId: worker.accountId, role: "worker"
    });
    const notification = await insertNotification(database, sql.notificationInsert, {
      character: "L", jobId: notificationJob, accountId: worker.accountId, role: "worker"
    });
    assert.ok(notification.row);
    const duplicateNotification = await database.query(sql.notificationInsert, [
      opaque("notification", "M"),
      "platform.foundation.ready",
      1,
      notificationJob,
      notification.projectionKey,
      worker.accountId,
      "worker",
      null,
      null,
      "Notification foundation ready",
      "This persisted notification verifies the current portal notification channel.",
      JSON.stringify({ fixtureRef: "fixture_L" }),
      "portal.dashboard",
      null
    ]);
    assert.equal(duplicateNotification.rows.length, 0);

    const [readOne, readTwo] = await Promise.all([
      database.query(sql.notificationMarkRead, [notification.row.notification_id, worker.accountId, "worker", null, null]),
      database.query(sql.notificationMarkRead, [notification.row.notification_id, worker.accountId, "worker", null, null])
    ]);
    assert.equal(readOne.rows.length + readTwo.rows.length, 1);
    await assert.rejects(
      database.query("UPDATE platform_notifications SET read_at = NULL WHERE notification_id = $1", [notification.row.notification_id]),
      /read state is one-way/
    );
    await assert.rejects(
      database.query("UPDATE platform_notifications SET title = 'changed' WHERE notification_id = $1", [notification.row.notification_id]),
      /immutable fields cannot be changed/
    );

    const emailJob = await insertJob(database, {
      character: "N", jobType: "email.delivery.foundation", accountId: worker.accountId, role: "worker"
    });
    const delivery = await insertDelivery(database, sql.emailQueue, {
      character: "N", jobId: emailJob, accountId: worker.accountId, role: "worker", email: worker.email
    });
    assert.ok(delivery.row);
    const duplicateDelivery = await database.query(sql.emailQueue, [
      opaque("email_delivery", "O"),
      1,
      emailJob,
      delivery.deliveryKey,
      worker.accountId,
      "worker",
      null,
      null,
      hash(worker.email)
    ]);
    assert.equal(duplicateDelivery.rows.length, 0);

    const audit = await insertAudit(database, sql.auditAppend, {
      character: "P", accountId: worker.accountId, role: "worker"
    });
    await assert.rejects(
      database.query("UPDATE platform_audit_events SET reason_key = 'changed' WHERE audit_event_id = $1", [audit.audit_event_id]),
      /append-only/
    );
    await assert.rejects(
      database.query("DELETE FROM platform_audit_events WHERE audit_event_id = $1", [audit.audit_event_id]),
      /append-only/
    );
    await assert.rejects(
      database.query("DELETE FROM platform_notifications WHERE notification_id = $1", [notification.row.notification_id]),
      /cannot be deleted/
    );
    await assert.rejects(
      database.query("DELETE FROM platform_email_deliveries WHERE delivery_id = $1", [delivery.row.delivery_id]),
      /delivery history cannot be deleted/
    );

    const plaintext = worker.email.toLowerCase();
    const leaked = await Promise.all([
      database.query("SELECT COUNT(*)::int AS count FROM platform_outbox_jobs WHERE LOWER(payload::text) LIKE $1", [`%${plaintext}%`]),
      database.query("SELECT COUNT(*)::int AS count FROM platform_audit_events WHERE LOWER(metadata::text) LIKE $1", [`%${plaintext}%`]),
      database.query("SELECT COUNT(*)::int AS count FROM platform_email_deliveries WHERE LOWER(recipient_address_hash) = $1", [plaintext])
    ]);
    assert.deepEqual(leaked.map((result) => Number(result.rows[0].count)), [0, 0, 0]);
    assert.equal(delivery.row.recipient_address_hash, hash(worker.email));

    await database.query(
      `UPDATE platform_outbox_jobs
       SET status = 'terminal_failed',
           attempt_count = 5,
           terminal_failed_at = CURRENT_TIMESTAMP,
           last_error_code = 'fixture_terminal',
           last_error_summary = 'Fixture asynchronous failure.',
           updated_at = CURRENT_TIMESTAMP
       WHERE job_id = $1`,
      [emailJob]
    );
    const committedCoreState = await database.query(
      "SELECT display_name FROM auth_accounts WHERE account_id = $1",
      [worker.accountId]
    );
    assert.equal(committedCoreState.rows[0].display_name, "committed core state");
  } finally {
    await database.close();
  }
});

test("combined M1.05 state and migration checksums persist across database close and reopen", async () => {
  const sql = await contracts();
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m105-final-"));
  const env = environment("m1-05-final-persistence", directory);
  let database = await openScriptDatabase(env);
  try {
    await applyPendingMigrations(database, env.releaseSha);
    const worker = await insertWorker(database, "persistent");
    const notificationJob = await insertJob(database, {
      character: "Q", jobType: "notification.portal.foundation", accountId: worker.accountId, role: "worker"
    });
    const notification = await insertNotification(database, sql.notificationInsert, {
      character: "Q", jobId: notificationJob, accountId: worker.accountId, role: "worker"
    });
    const emailJob = await insertJob(database, {
      character: "R", jobType: "email.delivery.foundation", accountId: worker.accountId, role: "worker"
    });
    const delivery = await insertDelivery(database, sql.emailQueue, {
      character: "R", jobId: emailJob, accountId: worker.accountId, role: "worker", email: worker.email
    });
    const audit = await insertAudit(database, sql.auditAppend, {
      character: "S", accountId: worker.accountId, role: "worker"
    });
    assert.ok(notification.row);
    assert.ok(delivery.row);
    assert.ok(audit);

    await database.close();
    database = await openScriptDatabase(env);

    const status = await migrationStatus(database);
    assert.deepEqual(status.map((migration) => migration.id), COMPLETE_MIGRATIONS);
    assert.equal(status.every((migration) => migration.applied && migration.checksumMatches), true);

    const retained = await Promise.all([
      database.query("SELECT audit_event_id FROM platform_audit_events WHERE audit_event_id = $1", [audit.audit_event_id]),
      database.query("SELECT job_id FROM platform_outbox_jobs WHERE job_id = $1", [notificationJob]),
      database.query("SELECT notification_id, read_at FROM platform_notifications WHERE notification_id = $1", [notification.row.notification_id]),
      database.query("SELECT delivery_id, recipient_address_hash FROM platform_email_deliveries WHERE delivery_id = $1", [delivery.row.delivery_id])
    ]);
    for (const result of retained) assert.equal(result.rows.length, 1);
    assert.equal(retained[2].rows[0].read_at, null);
    assert.equal(retained[3].rows[0].recipient_address_hash, hash(worker.email));
  } finally {
    await database.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
