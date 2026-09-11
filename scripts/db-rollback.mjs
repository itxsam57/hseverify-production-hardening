import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";
import { rollbackLatestMigration } from "./lib/migrations.mjs";

const environment = readProjectEnvironment();
const database = await openScriptDatabase(environment);

try {
  const rolledBack = await rollbackLatestMigration(database, environment);
  console.log(
    rolledBack ? `Rolled back migration: ${rolledBack}` : "No applied migration to roll back."
  );
} finally {
  await database.close();
}
