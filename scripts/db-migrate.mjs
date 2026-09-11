import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";
import { applyPendingMigrations } from "./lib/migrations.mjs";

const environment = readProjectEnvironment();
const database = await openScriptDatabase(environment);

try {
  const applied = await applyPendingMigrations(database, environment.releaseSha);
  if (applied.length === 0) {
    console.log("Database schema is current.");
  } else {
    console.log(`Applied migrations: ${applied.join(", ")}`);
  }
} finally {
  await database.close();
}
