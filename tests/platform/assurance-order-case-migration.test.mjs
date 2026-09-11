import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { migrationStatus, rollbackLatestMigration } from "../../scripts/lib/migrations.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0033_assurance_order_case_engine";
const TABLES = Object.freeze([
  "assurance_orders",
  "assurance_order_workers",
  "assurance_cases",
  "assurance_case_timeline_events",
  "assurance_action_items"
]);

function environment(path, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: path,
    releaseSha,
    sessionSecret: "m2-01-assurance-order-case-session-secret-with-more-than-thirty-two-characters",
    authPepper: "m2-01-assurance-order-case-auth-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function tableNames(database) {
  const result = await database.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[])
      ORDER BY table_name`,
    [[...TABLES]]
  );
  return result.rows.map((row) => row.table_name);
}

test("M2.01 migration owns the order/case/timeline/action persistence without hard lower-brick foreign keys", async () => {
  const upPath = resolve("database/migrations/0033_assurance_order_case_engine.up.sql");
  const downPath = resolve("database/migrations/0033_assurance_order_case_engine.down.sql");
  assert.equal(existsSync(upPath), true, "M2.01 up migration must exist");
  assert.equal(existsSync(downPath), true, "M2.01 down migration must exist");

  const up = readFileSync(upPath, "utf8");
  const down = readFileSync(downPath, "utf8");
  for (const table of TABLES) assert.ok(up.includes(table), table);
  assert.match(down, /monotonic[\s\S]*SELECT\s+1/i);
  assert.ok(!/DROP\s+(?:TABLE|TRIGGER|FUNCTION)/i.test(down));

  for (const lowerBrickTable of [
    "platform_tenants",
    "auth_tenant_memberships",
    "company_worker_links",
    "company_sites",
    "company_departments",
    "worker_identity_worker_ids"
  ]) {
    assert.ok(
      !new RegExp(`REFERENCES\\s+${lowerBrickTable}\\b`, "i").test(up),
      `M2.01 retained history must not hard-reference ${lowerBrickTable}`
    );
  }

  const database = await openScriptDatabase(environment("memory://", "m2-01-migration-shape"));
  try {
    await applyMigrationsThrough(database, "m2-01-migration-shape", OWNED_MIGRATION);
    assert.deepEqual(await tableNames(database), [...TABLES].sort());

    const orderStatuses = await database.query(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
        WHERE r.relname='assurance_orders' AND c.conname='assurance_orders_status_check'`
    );
    const definition = orderStatuses.rows[0]?.definition ?? "";
    for (const status of [
      "DRAFT","VALIDATION_FAILED","READY","SUBMITTED","PARTIALLY_FUNDED","ACTIVE","COMPLETED","CANCELLED","CLOSED"
    ]) assert.match(definition, new RegExp(`'${status}'`));
  } finally {
    await database.close();
  }
});

test("M2.01 database guards submitted scope, append-only timeline, one case per target and explicit pending ownership", async () => {
  const database = await openScriptDatabase(environment("memory://", "m2-01-db-guards"));
  try {
    await applyMigrationsThrough(database, "m2-01-db-guards", OWNED_MIGRATION);
    const up = readFileSync(resolve("database/migrations/0033_assurance_order_case_engine.up.sql"), "utf8");
    assert.match(up, /submitted[\s\S]{0,1200}(?:immutable|cannot be modified)/i);
    assert.match(up, /timeline[\s\S]{0,800}(?:cannot be updated|append-only|cannot be deleted)/i);
    assert.match(up, /UNIQUE\s*\([^)]*order_id[^)]*worker/i);
    assert.match(up, /owner_kind/);
    assert.match(up, /next_action/);
    assert.ok(!/\bprocessing\b/i.test(up));
  } finally {
    await database.close();
  }
});

test("M2.01 migration history survives restart and monotonic rollback/reapply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m201-migration-"));
  const databasePath = join(directory, "pglite");
  const env = environment(databasePath, "m2-01-restart");
  const previous = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  let database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const orderId = `assurance_order_${"R".repeat(24)}`;
    await database.query(
      `INSERT INTO assurance_orders (
         order_id,tenant_id,created_by_membership_id,order_name,order_reference,
         order_status,scope_version,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,'DRAFT',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [orderId, `tenant_${"T".repeat(24)}`, `membership_${"M".repeat(24)}`, "Rollback order", "RB-001"]
    );

    await database.close();
    database = await openScriptDatabase({ ...env, releaseSha: "m2-01-reopened" });
    const before = await database.query(`SELECT order_status FROM assurance_orders WHERE order_id=$1`, [orderId]);
    assert.equal(before.rows[0]?.order_status, "DRAFT");

    const rolledBack = await rollbackLatestMigration(database, env);
    assert.equal(rolledBack, OWNED_MIGRATION);
    const retained = await database.query(`SELECT order_status FROM assurance_orders WHERE order_id=$1`, [orderId]);
    assert.equal(retained.rows[0]?.order_status, "DRAFT");

    assert.deepEqual(
      await applyMigrationsThrough(database, "m2-01-reapply", OWNED_MIGRATION),
      [OWNED_MIGRATION]
    );
    const status = await migrationStatus(database);
    const owned = status.find((entry) => entry.id === OWNED_MIGRATION);
    assert.equal(owned?.applied, true);
    assert.equal(owned?.checksumMatches, true);
  } finally {
    if (database) await database.close();
    if (previous === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
