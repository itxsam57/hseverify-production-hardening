import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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

// Non-development release manifests may only describe a clean exact Git
// checkout. CI OIDC artifact signing is a separate required release gate.
if (applicationEnvironment === "preview" || applicationEnvironment === "production") {
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    throw new Error("Preview/production release manifests require a 40-character Git source SHA.");
  }
  let checkedOutSha;
  let changedTrackedInputs;
  try {
    checkedOutSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10_000
    }).trim();
    changedTrackedInputs = execFileSync("git", [
      "status", "--porcelain", "--untracked-files=no", "--",
      "src", "database", "scripts", "public", "package.json", "package-lock.json",
      "next.config.ts", "tsconfig.json", "eslint.config.mjs", ".github/workflows"
    ], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    throw new Error("Preview/production manifest requires an inspectable Git checkout.");
  }
  if (releaseSha !== checkedOutSha) {
    throw new Error("Release manifest source SHA does not match checked-out Git HEAD.");
  }
  if (changedTrackedInputs) {
    throw new Error("Release manifest refuses tracked source changes absent from the Git commit.");
  }
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
