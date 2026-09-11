import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MIGRATIONS_DIRECTORY = resolve("database", "migrations");

const MIGRATION_CHECKSUM_REPAIRS = Object.freeze({
  "0012_secure_file_upload_quarantine": Object.freeze({
    currentChecksum: "98507fbb39bfeba540a2a06b71e727f28123d35489a89b562dce8396e790af1b",
    acceptedPreviousChecksums: Object.freeze([
      "ca17b96eb02983a365bf2a560b4e2428f90efa0b9e845ea550e9ff7d227b04e5"
    ])
  }),
  "0013_secure_file_malware_scan": Object.freeze({
    currentChecksum: "89a0168ff92b2d0df5dad4d5f1b9b99ab5d5a2c92c1b28ce7e03fdf9a16baada",
    acceptedPreviousChecksums: Object.freeze([
      "b20f0a844faee01315562d9673a75df0494908259a7997d4a0d9e421bb0742d2",
      "8156083e26ac2c3ad354eddd44b13af801898db2d1cba35f2441c26ac2a18280"
    ])
  })
});

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function canonicalizeMigrationSql(content) {
  return content.replace(/\r\n?/g, "\n");
}

function lineEndingEquivalentChecksums(canonicalSql) {
  const canonicalChecksum = sha256(canonicalSql);
  const crlfChecksum = sha256(canonicalSql.replace(/\n/g, "\r\n"));
  return crlfChecksum === canonicalChecksum
    ? Object.freeze([])
    : Object.freeze([crlfChecksum]);
}

export function migrationChecksumCompatibility(
  migrationId,
  recordedChecksum,
  currentChecksum,
  acceptedLineEndingChecksums = []
) {
  if (recordedChecksum === currentChecksum) return "exact";
  if (acceptedLineEndingChecksums.includes(recordedChecksum)) {
    return "approved_line_ending_normalization";
  }
  const repair = MIGRATION_CHECKSUM_REPAIRS[migrationId];
  if (
    repair &&
    repair.currentChecksum === currentChecksum &&
    repair.acceptedPreviousChecksums.includes(recordedChecksum)
  ) {
    return "approved_repair";
  }
  return "mismatch";
}

export async function listMigrations() {
  const files = (await readdir(MIGRATIONS_DIRECTORY))
    .filter((file) => /^\d+_[a-z0-9_]+\.up\.sql$/.test(file))
    .sort();

  return Promise.all(
    files.map(async (file) => {
      const id = file.replace(/\.up\.sql$/, "");
      const rawUpSql = await readFile(resolve(MIGRATIONS_DIRECTORY, file), "utf8");
      const upSql = canonicalizeMigrationSql(rawUpSql);
      const downPath = resolve(MIGRATIONS_DIRECTORY, `${id}.down.sql`);
      const rawDownSql = await readFile(downPath, "utf8").catch(() => null);
      const downSql = rawDownSql === null ? null : canonicalizeMigrationSql(rawDownSql);
      return {
        id,
        upSql,
        downSql,
        checksum: sha256(upSql),
        acceptedLineEndingChecksums: lineEndingEquivalentChecksums(upSql)
      };
    })
  );
}

export async function ensureMigrationTable(database) {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS hse_schema_migrations (
      migration_id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      release_sha TEXT NOT NULL
    );
  `);
}

export async function migrationStatus(database) {
  await ensureMigrationTable(database);
  const migrations = await listMigrations();
  const appliedResult = await database.query(
    "SELECT migration_id, checksum, applied_at, release_sha FROM hse_schema_migrations ORDER BY migration_id"
  );
  const applied = new Map(appliedResult.rows.map((row) => [row.migration_id, row]));

  return migrations.map((migration) => {
    const record = applied.get(migration.id) ?? null;
    const checksumCompatibility = record
      ? migrationChecksumCompatibility(
          migration.id,
          record.checksum,
          migration.checksum,
          migration.acceptedLineEndingChecksums
        )
      : null;
    return {
      ...migration,
      applied: Boolean(record),
      appliedChecksum: record?.checksum ?? null,
      checksumMatches: !record || checksumCompatibility !== "mismatch",
      checksumCompatibility,
      appliedAt: record?.applied_at ?? null,
      releaseSha: record?.release_sha ?? null
    };
  });
}

async function normalizeApprovedChecksumRepair(database, migration) {
  if (
    ![
      "approved_repair",
      "approved_line_ending_normalization"
    ].includes(migration.checksumCompatibility) ||
    !migration.appliedChecksum
  ) {
    return;
  }

  await database.transaction(async (transaction) => {
    const updated = await transaction.query(
      `UPDATE hse_schema_migrations
       SET checksum = $1
       WHERE migration_id = $2 AND checksum = $3
       RETURNING migration_id`,
      [migration.checksum, migration.id, migration.appliedChecksum]
    );
    if (updated.rows.length === 1) return;

    const current = await transaction.query(
      "SELECT checksum FROM hse_schema_migrations WHERE migration_id = $1",
      [migration.id]
    );
    if (current.rows.length !== 1 || current.rows[0].checksum !== migration.checksum) {
      throw new Error(`Migration checksum repair race failed for ${migration.id}.`);
    }
  });
}

export async function applyPendingMigrations(database, releaseSha) {
  const status = await migrationStatus(database);
  const mismatched = status.filter((migration) => !migration.checksumMatches);
  if (mismatched.length > 0) {
    throw new Error(
      `Applied migration checksum mismatch: ${mismatched.map((item) => item.id).join(", ")}`
    );
  }

  for (const migration of status) {
    await normalizeApprovedChecksumRepair(database, migration);
  }

  const pending = status.filter((migration) => !migration.applied);
  for (const migration of pending) {
    await database.transaction(async (transaction) => {
      await transaction.execute(migration.upSql);
      await transaction.query(
        `INSERT INTO hse_schema_migrations (migration_id, checksum, release_sha)
         VALUES ($1, $2, $3)`,
        [migration.id, migration.checksum, releaseSha]
      );
    });
  }

  return pending.map((migration) => migration.id);
}

export async function rollbackLatestMigration(database, environment) {
  if (environment.appEnvironment === "preview" || environment.appEnvironment === "production") {
    throw new Error(
      "Destructive database rollback is prohibited in preview and production. Build and validate a previous release artifact instead."
    );
  }
  if (process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK !== "true") {
    throw new Error(
      "Set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true to acknowledge a local/test destructive rollback."
    );
  }

  const status = await migrationStatus(database);
  const mismatched = status.filter(
    (migration) => migration.applied && !migration.checksumMatches
  );
  if (mismatched.length > 0) {
    throw new Error(
      `Applied migration checksum mismatch: ${mismatched.map((item) => item.id).join(", ")}`
    );
  }

  const latest = [...status].reverse().find((migration) => migration.applied);
  if (!latest) {
    return null;
  }
  if (!latest.downSql) {
    throw new Error(`Migration ${latest.id} has no down migration.`);
  }

  await normalizeApprovedChecksumRepair(database, latest);
  await database.transaction(async (transaction) => {
    await transaction.execute(latest.downSql);
    await transaction.query(
      "DELETE FROM hse_schema_migrations WHERE migration_id = $1",
      [latest.id]
    );
  });
  return latest.id;
}

export async function migrationSetChecksum() {
  const migrations = await listMigrations();
  return sha256(
    migrations.map((migration) => `${migration.id}:${migration.checksum}`).join("\n")
  );
}
