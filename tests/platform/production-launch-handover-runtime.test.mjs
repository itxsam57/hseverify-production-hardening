import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { ensureProductionLaunchRuntime } from "../helpers/production-launch-runtime-bootstrap.mjs";

const runtime = ensureProductionLaunchRuntime();
const serviceModule = await import(
  pathToFileURL(join(runtime, "operations", "production-launch-service.js")).href
);
const {
  ProductionLaunchService,
  ReleaseHandoverAccessError,
  ReleaseHandoverConflictError,
  ReleaseHandoverInputError
} = serviceModule;

const NOW_DATE = new Date("2026-09-15T12:00:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const CHECKS = ["runbook", "support", "alerts", "rollback", "acceptance"];
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m3-12-production-launch-runtime-test",
  sessionSecret: "m3-12-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m3-12-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function database() {
  const instance = await openScriptDatabase(ENV);
  await applyMigrationsThrough(instance, ENV.releaseSha, "0059_production_launch_handover");
  return instance;
}

async function seedPrincipal(db, suffix, role = "admin", { revoked = false } = {}) {
  const accountId = `account_m312_${role}_${suffix}`;
  const sessionId = `session_m312_${role}_${suffix}`;
  const email = `${role}.m312.${suffix.toLowerCase()}@example.test`;
  await db.query(
    `INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
     VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, `${role} ${suffix}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await db.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)`,
    [accountId, role, NOW]
  );
  await db.query(
    `INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at,revoked_at,revocation_reason)
     VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
    [
      sessionId,
      accountId,
      role,
      `token-${suffix}-${role}`,
      `csrf-${suffix}-${role}`,
      NOW,
      FUTURE,
      revoked ? NOW : null,
      revoked ? "runtime_fixture_revoked" : null
    ]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: role,
    accountStatus: "active",
    email,
    displayName: `${role} ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null,
    authorizedPlatformPermission: "platform.operations.manage"
  });
}

test("M3.12 handover state persists all checks, audits writes, derives readiness, and rejects stale or invalid changes", async () => {
  const db = await database();
  try {
    const admin = await seedPrincipal(db, "A");
    const service = new ProductionLaunchService(db);
    const initial = await service.getReadiness(admin, NOW_DATE);
    assert.equal(initial.status, "attention");
    assert.deepEqual(
      initial.checks.map(({ name, status, revision }) => ({ name, status, revision })),
      CHECKS.map((name) => ({ name, status: "pending", revision: 0 }))
    );

    for (const name of CHECKS) {
      await service.updateCheck(
        admin,
        { name, status: "passed", expectedRevision: 0 },
        NOW_DATE
      );
    }

    const persisted = await service.getReadiness(admin, NOW_DATE);
    assert.equal(persisted.status, "ready");
    assert.deepEqual(
      persisted.checks.map(({ name, status, revision }) => ({ name, status, revision })),
      CHECKS.map((name) => ({ name, status: "passed", revision: 1 }))
    );
    const audits = await db.query(
      `SELECT action_key, actor_account_id, target_reference, metadata
       FROM platform_audit_events
       WHERE action_key = 'production_launch.handover.updated'
       ORDER BY audit_sequence`
    );
    assert.equal(audits.rows.length, 5);
    assert(audits.rows.every((row) => row.actor_account_id === admin.accountId));
    assert.deepEqual(audits.rows.map((row) => row.target_reference), CHECKS);

    await assert.rejects(
      service.updateCheck(
        admin,
        { name: "runbook", status: "failed", expectedRevision: 0 },
        NOW_DATE
      ),
      ReleaseHandoverConflictError
    );
    assert.deepEqual(
      (await service.getReadiness(admin, NOW_DATE)).checks.find((check) => check.name === "runbook"),
      persisted.checks.find((check) => check.name === "runbook")
    );

    for (const input of [
      { name: "unknown", status: "passed", expectedRevision: 0 },
      { name: "runbook", status: "unknown", expectedRevision: 1 },
      { name: "runbook", status: "passed", expectedRevision: -1 },
      { name: "runbook", status: "passed", expectedRevision: 1.5 }
    ]) {
      await assert.rejects(service.updateCheck(admin, input, NOW_DATE), ReleaseHandoverInputError);
    }
  } finally {
    await db.close();
  }
});

test("M3.12 handover service rejects revoked admin and non-admin sessions without mutation", async () => {
  const db = await database();
  try {
    const revoked = await seedPrincipal(db, "B", "admin", { revoked: true });
    const root = await seedPrincipal(db, "C", "root");
    const service = new ProductionLaunchService(db);

    await assert.rejects(service.getReadiness(revoked, NOW_DATE), ReleaseHandoverAccessError);
    await assert.rejects(
      service.updateCheck(
        revoked,
        { name: "runbook", status: "passed", expectedRevision: 0 },
        NOW_DATE
      ),
      ReleaseHandoverAccessError
    );
    await assert.rejects(service.getReadiness(root, NOW_DATE), ReleaseHandoverAccessError);
    await assert.rejects(
      service.updateCheck(
        root,
        { name: "runbook", status: "passed", expectedRevision: 0 },
        NOW_DATE
      ),
      ReleaseHandoverAccessError
    );

    const rows = await db.query(
      "SELECT check_name, status, revision FROM production_release_handover_checks ORDER BY check_name"
    );
    assert.equal(rows.rows.length, 5);
    assert(rows.rows.every((row) => row.status === "pending" && Number(row.revision) === 0));
  } finally {
    await db.close();
  }
});

test("M3.12 handover mutation rolls back when durable audit persistence fails", async () => {
  const db = await database();
  try {
    const admin = await seedPrincipal(db, "D");
    const service = new ProductionLaunchService(db);
    await db.execute(
      `ALTER TABLE platform_audit_events
       ADD CONSTRAINT m312_force_audit_failure
       CHECK (action_key <> 'production_launch.handover.updated')`
    );

    await assert.rejects(
      service.updateCheck(
        admin,
        { name: "alerts", status: "failed", expectedRevision: 0 },
        NOW_DATE
      )
    );
    const row = await db.query(
      "SELECT status, revision FROM production_release_handover_checks WHERE check_name = 'alerts'"
    );
    assert.equal(row.rows[0].status, "pending");
    assert.equal(Number(row.rows[0].revision), 0);
    const audits = await db.query(
      "SELECT audit_event_id FROM platform_audit_events WHERE action_key = 'production_launch.handover.updated'"
    );
    assert.equal(audits.rows.length, 0);
  } finally {
    await db.close();
  }
});
