import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const ROLES = ["worker", "company", "assessor", "verifier", "admin", "root"];
const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m1-05-final-role-matrix",
  sessionSecret: "m1-05-final-role-matrix-session-secret-32-characters",
  authPepper: "m1-05-final-role-matrix-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

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
  const [notification, email] = await Promise.all([
    readFile(resolve("src/lib/notifications/notification-repository.ts"), "utf8"),
    readFile(resolve("src/lib/email-delivery/email-delivery-repository.ts"), "utf8")
  ]);
  return {
    notificationInsert: extractSql(notification, "NOTIFICATION_INSERT_SQL"),
    notificationFind: extractSql(notification, "NOTIFICATION_FIND_SQL"),
    emailQueue: extractSql(email, "EMAIL_QUEUE_SQL"),
    emailFind: extractSql(email, "EMAIL_FIND_SCOPED_SQL")
  };
}

async function createPrincipal(database, role, index) {
  const character = String.fromCharCode(65 + index);
  const accountId = `account_m105_matrix_${role}`;
  const email = `m105-matrix-${role}@example.com`;
  let tenantId = null;
  let membershipId = null;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [accountId, email, `M1.05 Matrix ${role}`]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)`,
    [accountId, role]
  );

  if (role === "company") {
    tenantId = opaque("tenant", character);
    membershipId = opaque("membership", character);
    await database.query(
      `INSERT INTO platform_tenants (
         tenant_id, tenant_type, display_name, tenant_status,
         created_by_account_id, created_at, updated_at, activated_at
       ) VALUES ($1, 'company', 'M1.05 Matrix Company', 'active', $2,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [tenantId, accountId]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_by_account_id,
         created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [membershipId, tenantId, accountId]
    );
  }

  return { role, character, accountId, email, tenantId, membershipId };
}

async function createEffects(database, sql, principal) {
  const notificationJob = opaque("job", principal.character);
  const emailCharacter = String.fromCharCode(principal.character.charCodeAt(0) + 8);
  const emailJob = opaque("job", emailCharacter);

  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'notification.portal.foundation', 1, $2, $3::jsonb, $4, $5, $6, $7)`,
    [
      notificationJob,
      hash(`notification:${principal.role}`),
      JSON.stringify({ fixtureRef: `fixture_${principal.character}` }),
      principal.accountId,
      principal.role,
      principal.tenantId,
      principal.membershipId
    ]
  );
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'email.delivery.foundation', 1, $2, $3::jsonb, $4, $5, $6, $7)`,
    [
      emailJob,
      hash(`email:${principal.role}`),
      JSON.stringify({ fixtureRef: `email.foundation.success.${emailCharacter}` }),
      principal.accountId,
      principal.role,
      principal.tenantId,
      principal.membershipId
    ]
  );

  const notificationId = opaque("notification", principal.character);
  const projectionKey = hash(`notification-projection:${principal.role}`);
  const notification = await database.query(sql.notificationInsert, [
    notificationId,
    "platform.foundation.ready",
    1,
    notificationJob,
    projectionKey,
    principal.accountId,
    principal.role,
    principal.tenantId,
    principal.membershipId,
    "Notification foundation ready",
    "This persisted notification verifies the current portal notification channel.",
    JSON.stringify({ fixtureRef: `fixture_${principal.character}` }),
    "portal.dashboard",
    null
  ]);
  assert.equal(notification.rows.length, 1);

  const deliveryId = opaque("email_delivery", emailCharacter);
  const deliveryKey = hash(`email-delivery:${principal.role}`);
  const delivery = await database.query(sql.emailQueue, [
    deliveryId,
    1,
    emailJob,
    deliveryKey,
    principal.accountId,
    principal.role,
    principal.tenantId,
    principal.membershipId,
    hash(principal.email)
  ]);
  assert.equal(delivery.rows.length, 1);

  return { ...principal, notificationId, deliveryId };
}

test("all six fixed roles can read only their own notification and email recipient records", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const principals = [];
    for (let index = 0; index < ROLES.length; index += 1) {
      const principal = await createPrincipal(database, ROLES[index], index);
      principals.push(await createEffects(database, sql, principal));
    }

    for (const reader of principals) {
      for (const target of principals) {
        const shouldSee = reader.accountId === target.accountId && reader.role === target.role;
        const notification = await database.query(sql.notificationFind, [
          target.notificationId,
          reader.accountId,
          reader.role,
          reader.tenantId,
          reader.membershipId
        ]);
        const delivery = await database.query(sql.emailFind, [
          target.deliveryId,
          reader.accountId,
          reader.role,
          reader.tenantId,
          reader.membershipId
        ]);
        assert.equal(
          notification.rows.length,
          shouldSee ? 1 : 0,
          `${reader.role} notification access to ${target.role} must be isolated`
        );
        assert.equal(
          delivery.rows.length,
          shouldSee ? 1 : 0,
          `${reader.role} email access to ${target.role} must be isolated`
        );
      }
    }
  } finally {
    await database.close();
  }
});
