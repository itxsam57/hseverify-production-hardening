import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";
import { migrationStatus } from "./lib/migrations.mjs";

const environment = readProjectEnvironment();
const database = await openScriptDatabase(environment);

try {
  const status = await migrationStatus(database);
  let hasFailure = false;
  for (const migration of status) {
    const state = migration.applied
      ? migration.checksumMatches
        ? "applied"
        : "checksum-mismatch"
      : "pending";
    console.log(`${migration.id}: ${state}`);
    hasFailure ||= state !== "applied";
  }
  if (hasFailure) {
    process.exitCode = 1;
  }
} finally {
  await database.close();
}
