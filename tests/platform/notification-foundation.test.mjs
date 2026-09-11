import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "notification-foundation-test",
  sessionSecret: "notification-foundation-session-secret-32-characters",
  authPepper: "notification-foundation-auth-pepper-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function opaque(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
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
  const source = await readFile(
    resolve("src/lib/notifications/notification-repository.ts"),
    "utf8"
  );
  return {
    insert: extractSql(source, "NOTIFICATION_INSERT_SQL"),
    findProjection: extractSql(source, "NOTIFICATION_FIND_PROJECTION_SQL"),
    sessionGuard: extractSql(source, "NOTIFICATION_SESSION_GUARD_SQL"),
    companyGuard: extractSql(source, "NOTIFICATION_COMPANY_SCOPE_GUARD_SQL"),
    list: extractSql(source, "NOTIFICATION_LIST_SQL"),
    unread: extractSql(source, "NOTIFICATION_UNREAD_COUNT_SQL"),
    find: extractSql(source, "NOTIFICATION_FIND_SQL"),
    markRead: extractSql(source, "NOTIFICATION_MARK_READ_SQL")
  };
}

async function insertActiveAccount(database, suffix, role) {
  const accountId = `account_notification_${suffix}`;
  const now = "2026-08-07T08:00:00.000Z";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `${suffix}@example.com`, `Notification ${suffix}`, now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, $3)`,
    [accountId, role, now]
  );
  return { accountId, now };
}

async function insertSession(database, accountId, role, suffix, now) {
  const sessionId = `session_notification_${suffix}`;
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [
      sessionId,
      accountId,
      role,
      `token-hash-${suffix}`,
      `csrf-hash-${suffix}`,
      now,
      "2099-01-01T00:00:00.000Z"
    ]
  );
  return sessionId;
}

async function insertCompanyScope(database, accountId, suffix, now) {
  const tenantId = opaque("tenant", suffix);
  const membershipId = opaque("membership", suffix);
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `Tenant ${suffix}`, accountId, now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, now]
  );
  return { tenantId, membershipId };
}

async function insertCompanionOwner(
  database,
  scope,
  createdByAccountId,
  suffix,
  now
) {
  const accountId = `account_notification_companion_${suffix}`;
  const membershipId = opaque("membership", suffix);
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [
      accountId,
      `notification-companion-${suffix.toLowerCase()}@example.com`,
      `Notification Companion ${suffix}`,
      now
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, now]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
    [membershipId, scope.tenantId, accountId, createdByAccountId, now]
  );
}

async function insertJob(database, input) {
  const jobId = opaque("job", input.character);
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, $2, 1, $3, $4::jsonb, $5, $6, $7, $8)`,
    [
      jobId,
      input.jobType ?? "notification.portal.foundation",
      input.character.toLowerCase().repeat(64),
      JSON.stringify(input.payload ?? { fixtureRef: `fixture_${input.character}` }),
      input.accountId,
      input.role,
      input.tenantId ?? null,
      input.membershipId ?? null
    ]
  );
  return jobId;
}

async function insertNotification(database, sql, input) {
  return database.query(sql, [
    opaque("notification", input.character),
    "platform.foundation.ready",
    1,
    input.jobId,
    input.character.toLowerCase().repeat(64),
    input.accountId,
    input.role,
    input.tenantId ?? null,
    input.membershipId ?? null,
    "Notification foundation ready",
    "This persisted notification verifies the current portal notification channel.",
    JSON.stringify(input.payload ?? { fixtureRef: `fixture_${input.character}` }),
    "portal.dashboard",
    null
  ]);
}

test("notification projection is outbox-bound, idempotent, immutable and one-way readable", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    const applied = await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    assert.ok(
      applied.includes("0009_persisted_notifications"),
      "notification foundation migration must be applied even when newer layers exist"
    );

    const worker = await insertActiveAccount(database, "worker", "worker");
    const sessionId = await insertSession(
      database,
      worker.accountId,
      "worker",
      "worker",
      worker.now
    );
    const jobId = await insertJob(database, {
      character: "A",
      accountId: worker.accountId,
      role: "worker"
    });
    const first = await insertNotification(database, sql.insert, {
      character: "A",
      jobId,
      accountId: worker.accountId,
      role: "worker"
    });
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].read_at, null);

    const duplicate = await database.query(sql.insert, [
      opaque("notification", "B"),
      "platform.foundation.ready",
      1,
      jobId,
      "a".repeat(64),
      worker.accountId,
      "worker",
      null,
      null,
      "Notification foundation ready",
      "This persisted notification verifies the current portal notification channel.",
      JSON.stringify({ fixtureRef: "fixture_A" }),
      "portal.dashboard",
      null
    ]);
    assert.equal(duplicate.rows.length, 0);

    const guard = await database.query(sql.sessionGuard, [
      sessionId,
      worker.accountId,
      "worker"
    ]);
    assert.equal(guard.rows.length, 1);

    const unreadBefore = await database.query(sql.unread, [
      worker.accountId,
      "worker",
      null,
      null
    ]);
    assert.equal(Number(unreadBefore.rows[0].unread_count), 1);

    const [readOne, readTwo] = await Promise.all([
      database.query(sql.markRead, [
        first.rows[0].notification_id,
        worker.accountId,
        "worker",
        null,
        null
      ]),
      database.query(sql.markRead, [
        first.rows[0].notification_id,
        worker.accountId,
        "worker",
        null,
        null
      ])
    ]);
    assert.equal(readOne.rows.length + readTwo.rows.length, 1);

    const stored = await database.query(
      `SELECT read_at, created_at, updated_at
       FROM platform_notifications
       WHERE notification_id = $1`,
      [first.rows[0].notification_id]
    );
    assert.ok(stored.rows[0].read_at);
    assert.equal(
      new Date(stored.rows[0].read_at).toISOString(),
      new Date(stored.rows[0].updated_at).toISOString()
    );

    await assert.rejects(
      database.query(
        `UPDATE platform_notifications SET title = 'Changed'
         WHERE notification_id = $1`,
        [first.rows[0].notification_id]
      ),
      /immutable fields cannot be changed/
    );
    await assert.rejects(
      database.query(
        `UPDATE platform_notifications SET read_at = NULL
         WHERE notification_id = $1`,
        [first.rows[0].notification_id]
      ),
      /read state is one-way/
    );
    await assert.rejects(
      database.query(
        `DELETE FROM platform_notifications WHERE notification_id = $1`,
        [first.rows[0].notification_id]
      ),
      /cannot be deleted/
    );

    const noopJobId = await insertJob(database, {
      character: "C",
      accountId: worker.accountId,
      role: "worker",
      jobType: "platform.foundation.noop",
      payload: { probeRef: "probe_C" }
    });
    await assert.rejects(
      insertNotification(database, sql.insert, {
        character: "C",
        jobId: noopJobId,
        accountId: worker.accountId,
        role: "worker",
        payload: { probeRef: "probe_C" }
      }),
      /registered notification outbox job/
    );
  } finally {
    await database.close();
  }
});

test("recipient role and Company tenant scope are direct SQL boundaries and revoked scope disappears without deleting history", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "notification-isolation-test"
  });
  try {
    await applyPendingMigrations(database, "notification-isolation-test");
    const companyA = await insertActiveAccount(database, "companya", "company");
    const companyB = await insertActiveAccount(database, "companyb", "company");
    const scopeA = await insertCompanyScope(database, companyA.accountId, "A", companyA.now);
    const scopeB = await insertCompanyScope(database, companyB.accountId, "B", companyB.now);

    const jobA = await insertJob(database, {
      character: "D",
      accountId: companyA.accountId,
      role: "company",
      ...scopeA
    });
    const jobB = await insertJob(database, {
      character: "E",
      accountId: companyB.accountId,
      role: "company",
      ...scopeB
    });
    const notificationA = await insertNotification(database, sql.insert, {
      character: "D",
      jobId: jobA,
      accountId: companyA.accountId,
      role: "company",
      ...scopeA
    });
    const notificationB = await insertNotification(database, sql.insert, {
      character: "E",
      jobId: jobB,
      accountId: companyB.accountId,
      role: "company",
      ...scopeB
    });
    assert.equal(notificationA.rows.length, 1);
    assert.equal(notificationB.rows.length, 1);

    const listA = await database.query(sql.list, [
      companyA.accountId,
      "company",
      scopeA.tenantId,
      scopeA.membershipId,
      null,
      50
    ]);
    assert.deepEqual(
      listA.rows.map((row) => row.notification_id),
      [notificationA.rows[0].notification_id]
    );

    const crossTenantFind = await database.query(sql.find, [
      notificationB.rows[0].notification_id,
      companyA.accountId,
      "company",
      scopeA.tenantId,
      scopeA.membershipId
    ]);
    const crossRoleFind = await database.query(sql.find, [
      notificationA.rows[0].notification_id,
      companyA.accountId,
      "worker",
      null,
      null
    ]);
    assert.equal(crossTenantFind.rows.length, 0);
    assert.equal(crossRoleFind.rows.length, 0);

    const liveGuard = await database.query(sql.companyGuard, [
      scopeA.membershipId,
      scopeA.tenantId,
      companyA.accountId
    ]);
    assert.equal(liveGuard.rows.length, 1);

    await insertCompanionOwner(
      database,
      scopeA,
      companyA.accountId,
      "X",
      companyA.now
    );
    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'revoked', revoked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE membership_id = $1`,
      [scopeA.membershipId]
    );
    const revokedGuard = await database.query(sql.companyGuard, [
      scopeA.membershipId,
      scopeA.tenantId,
      companyA.accountId
    ]);
    assert.equal(revokedGuard.rows.length, 0);

    const history = await database.query(
      `SELECT notification_id FROM platform_notifications
       WHERE notification_id = $1`,
      [notificationA.rows[0].notification_id]
    );
    assert.equal(history.rows.length, 1);
  } finally {
    await database.close();
  }
});
