import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { migrationSetChecksum } from "./lib/migrations.mjs";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const releaseSha = process.env.HSE_RELEASE_SHA?.trim() || "local-development";
const applicationEnvironment = process.env.HSE_RELEASE_ENV?.trim() || "development";
if (!["development", "test", "preview", "production"].includes(applicationEnvironment)) {
  throw new Error("HSE_RELEASE_ENV must be development, test, preview or production.");
}

const packageLock = await readFile(resolve("package-lock.json"));
const manifest = {
  schemaVersion: 1,
  releaseSha,
  applicationEnvironment,
  nodeVersion: process.version,
  packageLockSha256: sha256(packageLock),
  migrationSetSha256: await migrationSetChecksum(),
  createdAt: new Date().toISOString()
};

await writeFile(
  resolve("release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
console.log(`Release manifest created for ${releaseSha}.`);
