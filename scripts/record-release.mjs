import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";
import { applyPendingMigrations } from "./lib/migrations.mjs";

const environment = readProjectEnvironment();
const manifest = JSON.parse(await readFile(resolve("release-manifest.json"), "utf8"));
if (manifest.releaseSha !== environment.releaseSha) {
  throw new Error("Release manifest SHA does not match HSE_RELEASE_SHA.");
}

const database = await openScriptDatabase(environment);
try {
  await applyPendingMigrations(database, environment.releaseSha);
  await database.query(
    `INSERT INTO deployment_releases (
       release_sha, application_environment, package_lock_sha256,
       migration_set_sha256, created_at
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (release_sha) DO UPDATE SET
       application_environment = EXCLUDED.application_environment,
       package_lock_sha256 = EXCLUDED.package_lock_sha256,
       migration_set_sha256 = EXCLUDED.migration_set_sha256`,
    [
      manifest.releaseSha,
      manifest.applicationEnvironment,
      manifest.packageLockSha256,
      manifest.migrationSetSha256,
      manifest.createdAt
    ]
  );
  console.log(`Recorded release ${manifest.releaseSha}.`);
} finally {
  await database.close();
}
