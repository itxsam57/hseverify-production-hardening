import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  applyPendingMigrations,
  listMigrations,
  migrationChecksumCompatibility,
  migrationStatus
} from "../../scripts/lib/migrations.mjs";

const REPAIRS = Object.freeze([
  Object.freeze({
    id: "0012_secure_file_upload_quarantine",
    acceptedPreviousChecksums: Object.freeze([
      "ca17b96eb02983a365bf2a560b4e2428f90efa0b9e845ea550e9ff7d227b04e5"
    ]),
    repairedChecksum:
      "98507fbb39bfeba540a2a06b71e727f28123d35489a89b562dce8396e790af1b"
  }),
  Object.freeze({
    id: "0013_secure_file_malware_scan",
    acceptedPreviousChecksums: Object.freeze([
      "b20f0a844faee01315562d9673a75df0494908259a7997d4a0d9e421bb0742d2",
      "8156083e26ac2c3ad354eddd44b13af801898db2d1cba35f2441c26ac2a18280"
    ]),
    repairedChecksum:
      "89a0168ff92b2d0df5dad4d5f1b9b99ab5d5a2c92c1b28ce7e03fdf9a16baada"
  })
]);
const INVALID_CHECKSUM = "0".repeat(64);
const WINDOWS_0012_CHECKSUM =
  "cdf728a36e2b9ecd83978eeefeed64edd3fb6532ff1a179033c7244cf27a060a";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "migration-checksum-repair-test",
  sessionSecret: "migration-checksum-repair-session-secret-32-chars",
  authPepper: "migration-checksum-repair-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function checksum(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

test("migration checksum repairs are pinned to exact historical/current pairs", async () => {
  const migrations = await listMigrations();
  for (const repair of REPAIRS) {
    const migration = migrations.find((entry) => entry.id === repair.id);
    assert.ok(migration, `${repair.id} must remain registered`);
    assert.equal(migration.checksum, repair.repairedChecksum);

    assert.equal(
      migrationChecksumCompatibility(
        repair.id,
        repair.repairedChecksum,
        repair.repairedChecksum
      ),
      "exact"
    );
    for (const previousChecksum of repair.acceptedPreviousChecksums) {
      assert.equal(
        migrationChecksumCompatibility(
          repair.id,
          previousChecksum,
          repair.repairedChecksum
        ),
        "approved_repair"
      );
      assert.equal(
        migrationChecksumCompatibility(
          repair.id,
          previousChecksum,
          INVALID_CHECKSUM
        ),
        "mismatch",
        "a later unapproved edit must not inherit a historical checksum exception"
      );
    }
    assert.equal(
      migrationChecksumCompatibility(
        repair.id,
        INVALID_CHECKSUM,
        repair.repairedChecksum
      ),
      "mismatch"
    );
  }
});

test("Windows CRLF checkout hashes normalize to the canonical migration checksum", async () => {
  const migrations = await listMigrations();
  const migration = migrations.find(
    (entry) => entry.id === "0012_secure_file_upload_quarantine"
  );
  assert.ok(migration, "0012 migration must remain registered");

  const crlfChecksum = checksum(migration.upSql.replace(/\n/g, "\r\n"));
  assert.equal(crlfChecksum, WINDOWS_0012_CHECKSUM);
  assert.equal(migration.checksum, REPAIRS[0].repairedChecksum);
  assert.equal(migration.acceptedLineEndingChecksums.includes(crlfChecksum), true);
  assert.equal(
    migrationChecksumCompatibility(
      migration.id,
      crlfChecksum,
      migration.checksum,
      migration.acceptedLineEndingChecksums
    ),
    "approved_line_ending_normalization"
  );

  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    await database.query(
      "UPDATE hse_schema_migrations SET checksum = $1 WHERE migration_id = $2",
      [crlfChecksum, migration.id]
    );

    let status = await migrationStatus(database);
    const windowsEntry = status.find((entry) => entry.id === migration.id);
    assert.equal(windowsEntry?.checksumMatches, true);
    assert.equal(
      windowsEntry?.checksumCompatibility,
      "approved_line_ending_normalization"
    );

    assert.deepEqual(
      await applyPendingMigrations(database, "windows-line-ending-normalize"),
      []
    );
    status = await migrationStatus(database);
    const normalized = status.find((entry) => entry.id === migration.id);
    assert.equal(normalized?.appliedChecksum, migration.checksum);
    assert.equal(normalized?.checksumCompatibility, "exact");
  } finally {
    await database.close();
  }
});

test("every approved legacy checksum normalizes once while every unknown mismatch still fails closed", async () => {
  for (const repair of REPAIRS) {
    for (const previousChecksum of repair.acceptedPreviousChecksums) {
      const database = await openScriptDatabase(ENVIRONMENT);
      try {
        await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
        await database.query(
          "UPDATE hse_schema_migrations SET checksum = $1 WHERE migration_id = $2",
          [previousChecksum, repair.id]
        );

        let status = await migrationStatus(database);
        const entry = status.find((item) => item.id === repair.id);
        assert.equal(entry?.checksumMatches, true);
        assert.equal(entry?.checksumCompatibility, "approved_repair");
        assert.equal(entry?.appliedChecksum, previousChecksum);

        assert.deepEqual(
          await applyPendingMigrations(database, "migration-checksum-repair-normalize"),
          []
        );

        const normalizedLedger = await database.query(
          "SELECT checksum, release_sha FROM hse_schema_migrations WHERE migration_id = $1",
          [repair.id]
        );
        assert.equal(normalizedLedger.rows[0].checksum, repair.repairedChecksum);
        assert.equal(
          normalizedLedger.rows[0].release_sha,
          ENVIRONMENT.releaseSha,
          "metadata repair must not rewrite the release that originally applied the migration"
        );
      } finally {
        await database.close();
      }
    }
  }

  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    const tampered = REPAIRS[1];
    await database.query(
      "UPDATE hse_schema_migrations SET checksum = $1 WHERE migration_id = $2",
      [INVALID_CHECKSUM, tampered.id]
    );
    const status = await migrationStatus(database);
    const invalid = status.find((entry) => entry.id === tampered.id);
    assert.equal(invalid?.checksumMatches, false);
    assert.equal(invalid?.checksumCompatibility, "mismatch");
    await assert.rejects(
      () => applyPendingMigrations(database, "must-not-run"),
      /Applied migration checksum mismatch: 0013_secure_file_malware_scan/
    );
  } finally {
    await database.close();
  }
});
