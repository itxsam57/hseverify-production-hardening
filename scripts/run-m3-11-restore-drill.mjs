import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openScriptDatabase } from "./lib/database.mjs";
import { applyPendingMigrations } from "./lib/migrations.mjs";

const root = await mkdtemp(join(tmpdir(), "hse-m311-restore-"));
const sourceDirectory = join(root, "source");
const backupDirectory = join(root, "backup");
const restoredDirectory = join(root, "restored");
const markerId = "m311_restore_marker";
const markerEvidence = "M3.11 physical PGlite backup/restore marker";

function environment(dataDirectory) {
  return {
    databaseDriver: "pglite",
    pgliteDataDir: dataDirectory
  };
}

let source = null;
let restored = null;

try {
  source = await openScriptDatabase(environment(sourceDirectory));
  const applied = await applyPendingMigrations(source, "m3-11-restore-source");
  assert(applied.length > 0, "restore source must execute the real migration stack");

  await source.query(
    `INSERT INTO operations_certification_drills(
       drill_id,drill_name,status,evidence
     ) VALUES($1,'restore','passed',$2)`,
    [markerId, markerEvidence]
  );

  const migrationCountBefore = await source.query(
    "SELECT COUNT(*)::int AS count FROM hse_schema_migrations"
  );
  const expectedMigrationCount = Number(migrationCountBefore.rows[0]?.count ?? 0);
  assert(expectedMigrationCount > 0, "restore source migration history must be populated");

  await source.close();
  source = null;

  await cp(sourceDirectory, backupDirectory, { recursive: true });
  await cp(backupDirectory, restoredDirectory, { recursive: true });

  restored = await openScriptDatabase(environment(restoredDirectory));
  const marker = await restored.query(
    "SELECT drill_name,status,evidence FROM operations_certification_drills WHERE drill_id=$1",
    [markerId]
  );
  assert.equal(marker.rows.length, 1, "restored database must contain the certification marker");
  assert.equal(marker.rows[0].drill_name, "restore");
  assert.equal(marker.rows[0].status, "passed");
  assert.equal(marker.rows[0].evidence, markerEvidence);

  const migrationCountAfter = await restored.query(
    "SELECT COUNT(*)::int AS count FROM hse_schema_migrations"
  );
  assert.equal(
    Number(migrationCountAfter.rows[0]?.count ?? 0),
    expectedMigrationCount,
    "restored migration history must match the backed-up database"
  );

  console.log(JSON.stringify({
    status: "PASS",
    drill: "restore",
    evidence: "Physical PGlite data directory copied, restored and verified with migration history intact.",
    migrationCount: expectedMigrationCount
  }));
} finally {
  await source?.close().catch(() => undefined);
  await restored?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
