import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  assertCertificationSnapshotIsReady,
  runCertificationDrills
} from "../src/lib/operations/certification-readiness-domain.ts";
import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";
import { applyPendingMigrations, migrationStatus } from "./lib/migrations.mjs";

const targetEnvironment = readProjectEnvironment();
const artifactDirectory = resolve("artifacts", "m3-11");
const artifactPath = resolve(artifactDirectory, "certification.json");

const isolatedEnvironment = {
  ...process.env,
  HSE_APP_ENV: "test",
  HSE_DATABASE_DRIVER: "pglite",
  HSE_PGLITE_DATA_DIR: "memory://",
  DATABASE_URL: "",
  HSE_RELEASE_SHA: "m3-11-isolated-drill",
  HSE_ENABLE_AUTH_SANDBOX: "false",
  HSE_ENABLE_WORKER_DEMO_AUTH: "false",
  HSE_USE_WORKER_DEMO_DATA: "false"
};

function conciseFailure(result) {
  const combined = [result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return combined.slice(-8).join(" | ").slice(0, 1600);
}

function executeCommand(label, command, args) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: isolatedEnvironment,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024
  });
  const elapsedMs = Math.round(performance.now() - started);
  if (result.status !== 0) {
    throw new Error(
      `${label} failed after ${elapsedMs}ms (exit ${result.status ?? "unknown"}): ${conciseFailure(result)}`
    );
  }
  return `${label} passed in ${elapsedMs}ms using ${command} ${args.join(" ")}`;
}

async function prepareCertificationStore(database) {
  if (
    targetEnvironment.databaseDriver === "pglite" &&
    (targetEnvironment.appEnvironment === "development" || targetEnvironment.appEnvironment === "test")
  ) {
    await applyPendingMigrations(database, targetEnvironment.releaseSha);
    return;
  }

  const status = await migrationStatus(database);
  const mismatched = status.filter((migration) => migration.applied && !migration.checksumMatches);
  const pending = status.filter((migration) => !migration.applied);
  if (mismatched.length > 0 || pending.length > 0) {
    throw new Error(
      `M3.11 certification will not mutate a preview/production database with migration drift. ` +
      `mismatched=${mismatched.map((item) => item.id).join(",") || "none"}; ` +
      `pending=${pending.map((item) => item.id).join(",") || "none"}`
    );
  }
}

const startedAt = new Date().toISOString();
const snapshot = await runCertificationDrills({
  concurrency: () =>
    executeCommand(
      "High-risk concurrency/load regression",
      process.execPath,
      ["scripts/run-phase1-retrospective-performance.mjs"]
    ),
  tenant_isolation: () =>
    executeCommand(
      "Tenant isolation regression",
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "test:tenant-scope"]
    ),
  restore: () =>
    executeCommand(
      "Physical database backup/restore drill",
      process.execPath,
      ["scripts/run-m3-11-restore-drill.mjs"]
    ),
  incident: () =>
    executeCommand(
      "Operational failure rollback and recovery regression",
      process.execPath,
      ["--test", "tests/platform/production-launch-handover-runtime.test.mjs"]
    )
});

await mkdir(artifactDirectory, { recursive: true });
await writeFile(
  artifactPath,
  JSON.stringify(
    {
      releaseSha: targetEnvironment.releaseSha,
      environment: targetEnvironment.appEnvironment,
      startedAt,
      completedAt: new Date().toISOString(),
      ...snapshot
    },
    null,
    2
  ) + "\n",
  "utf8"
);

const database = await openScriptDatabase(targetEnvironment);
try {
  await prepareCertificationStore(database);
  await database.transaction(async (tx) => {
    await tx.execute("DELETE FROM operations_certification_drills");
    for (const drill of snapshot.drills) {
      await tx.query(
        `INSERT INTO operations_certification_drills(
           drill_id,drill_name,status,evidence
         ) VALUES($1,$2,$3,$4)`,
        [randomUUID(), drill.name, drill.status, drill.evidence]
      );
    }
  });

  const persisted = await database.query(
    "SELECT drill_name,status,evidence FROM operations_certification_drills ORDER BY drill_name"
  );
  if (persisted.rows.length !== 4) {
    throw new Error("M3.11 certification persistence did not retain all four required drills.");
  }
} finally {
  await database.close();
}

console.log(`M3.11 certification evidence written to ${artifactPath}`);
console.log(JSON.stringify(snapshot, null, 2));
assertCertificationSnapshotIsReady(snapshot);
