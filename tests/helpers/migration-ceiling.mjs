import {
  ensureMigrationTable,
  listMigrations,
  migrationChecksumCompatibility
} from "../../scripts/lib/migrations.mjs";

export async function applyMigrationsThrough(
  database,
  releaseSha,
  finalMigrationId
) {
  await ensureMigrationTable(database);
  const migrations = await listMigrations();
  const finalIndex = migrations.findIndex(
    (migration) => migration.id === finalMigrationId
  );
  if (finalIndex < 0) {
    throw new Error(`Unknown migration ceiling: ${finalMigrationId}`);
  }
  const selected = migrations.slice(0, finalIndex + 1);
  const appliedResult = await database.query(
    "SELECT migration_id, checksum FROM hse_schema_migrations ORDER BY migration_id"
  );
  const applied = new Map(
    appliedResult.rows.map((row) => [row.migration_id, row.checksum])
  );
  const beyondCeiling = appliedResult.rows.filter(
    (row) => migrations.findIndex((migration) => migration.id === row.migration_id) > finalIndex
  );
  if (beyondCeiling.length > 0) {
    throw new Error(
      `Migration ceiling test database already contains later migrations: ${beyondCeiling
        .map((row) => row.migration_id)
        .join(", ")}`
    );
  }

  const newlyApplied = [];
  for (const migration of selected) {
    const recordedChecksum = applied.get(migration.id);
    if (recordedChecksum) {
      const compatibility = migrationChecksumCompatibility(
        migration.id,
        recordedChecksum,
        migration.checksum
      );
      if (compatibility === "mismatch") {
        throw new Error(`Migration ceiling checksum mismatch: ${migration.id}`);
      }
      continue;
    }
    await database.transaction(async (transaction) => {
      await transaction.execute(migration.upSql);
      await transaction.query(
        `INSERT INTO hse_schema_migrations (migration_id, checksum, release_sha)
         VALUES ($1, $2, $3)`,
        [migration.id, migration.checksum, releaseSha]
      );
    });
    newlyApplied.push(migration.id);
  }

  return newlyApplied;
}
