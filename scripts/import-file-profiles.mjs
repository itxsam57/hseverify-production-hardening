import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";
import { applyPendingMigrations } from "./lib/migrations.mjs";

function assertProfile(value, source) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schemaVersion !== 1 ||
    typeof value.workerSub !== "string" ||
    typeof value.workerId !== "string" ||
    typeof value.version !== "number" ||
    !value.personal ||
    !value.contact ||
    !value.professional ||
    !Array.isArray(value.audit)
  ) {
    throw new Error(`Invalid legacy worker profile: ${source}`);
  }
}

const environment = readProjectEnvironment();
const sourceDirectory = resolve(
  process.env.HSE_LEGACY_PROFILE_STORAGE_DIR?.trim() || ".data/worker-profiles"
);
const overwrite = process.env.HSE_IMPORT_OVERWRITE === "true";
const database = await openScriptDatabase(environment);

try {
  await applyPendingMigrations(database, environment.releaseSha);
  const files = (await readdir(sourceDirectory)).filter((file) => file.endsWith(".json"));
  let imported = 0;
  let skipped = 0;

  for (const file of files) {
    const source = resolve(sourceDirectory, file);
    const profile = JSON.parse(await readFile(source, "utf8"));
    assertProfile(profile, source);
    const statement = overwrite
      ? `INSERT INTO worker_profiles (
           worker_sub, worker_id, schema_version, version, status, profile_document,
           created_at, updated_at, submitted_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (worker_sub) DO UPDATE SET
           worker_id = EXCLUDED.worker_id,
           schema_version = EXCLUDED.schema_version,
           version = EXCLUDED.version,
           status = EXCLUDED.status,
           profile_document = EXCLUDED.profile_document,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at,
           submitted_at = EXCLUDED.submitted_at
         RETURNING worker_sub`
      : `INSERT INTO worker_profiles (
           worker_sub, worker_id, schema_version, version, status, profile_document,
           created_at, updated_at, submitted_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (worker_sub) DO NOTHING
         RETURNING worker_sub`;
    const result = await database.query(statement, [
      profile.workerSub,
      profile.workerId,
      profile.schemaVersion,
      profile.version,
      profile.status,
      JSON.stringify(profile),
      profile.createdAt,
      profile.updatedAt,
      profile.submittedAt
    ]);
    if (result.affectedRows > 0 || result.rows.length > 0) {
      imported += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`Legacy profile import complete. Imported: ${imported}. Skipped: ${skipped}.`);
} finally {
  await database.close();
}
