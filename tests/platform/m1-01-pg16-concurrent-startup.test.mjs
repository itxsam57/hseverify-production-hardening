import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import postgres from "postgres";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { listMigrations, migrationStatus } from "../../scripts/lib/migrations.mjs";

const baseUrl = process.env.HSE_POSTGRES_TEST_DATABASE_URL;
const releaseSha = process.env.HSE_RELEASE_SHA;
if (!baseUrl || !["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)) {
  throw new Error("Concurrent migrations require a dedicated loopback PG16 test server.");
}
if (!/^[a-f0-9]{40}$/.test(releaseSha ?? "")) {
  throw new Error("Exact source SHA is required.");
}
const sourceRoot = resolve(".");
const testName = "M1.01.02 fresh PostgreSQL16 database serializes two simultaneous migration deploy processes";

function makeTemporaryDatabaseName() {
  return "zero001_parallel_" + randomBytes(8).toString("hex");
}

async function spawnMigrator(databaseUrl) {
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    HSE_APP_ENV: "test",
    HSE_DATABASE_DRIVER: "postgres",
    DATABASE_URL: databaseUrl,
    HSE_RELEASE_SHA: releaseSha,
    HSE_SESSION_SECRET: "zero001-parallel-test-session-secret-at-least-32",
    HSE_AUTH_PEPPER: "zero001-parallel-test-auth-pepper-at-least-32",
    HSE_ENABLE_AUTH_SANDBOX: "false",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: sourceRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let finished = false;
    const watchdog = setTimeout(() => {
      if (!finished) child.kill("SIGKILL");
    }, 125_000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-32_000);
      });
    }
    child.once("error", (error) => {
      finished = true;
      clearTimeout(watchdog);
      reject(error);
    });
    child.once("close", (code, signal) => {
      finished = true;
      clearTimeout(watchdog);
      resolveResult({ code, signal, output });
    });
  });
}

test(testName, { timeout: 200_000 }, async () => {
  const databaseName = makeTemporaryDatabaseName();
  const quotedName = '"' + databaseName + '"';
  const admin = postgres(baseUrl, { max: 1, prepare: false });
  let created = false;
  let verification = null;
  try {
    await admin.unsafe("CREATE DATABASE " + quotedName);
    created = true;
    const targetUrl = new URL(baseUrl);
    targetUrl.pathname = "/" + databaseName;
    const databaseUrl = targetUrl.toString();

    // Start both real Node deployment processes before awaiting either one.
    const outcomes = await Promise.all([
      spawnMigrator(databaseUrl),
      spawnMigrator(databaseUrl)
    ]);
    assert.deepEqual(
      outcomes.map(({ code, signal }) => ({ code, signal })),
      [{ code: 0, signal: null }, { code: 0, signal: null }],
      "Both migration commands must succeed on a fresh database; " +
        outcomes.map(({ code, output }) =>
          "exit=" + code + " output-tail=" + output.slice(-350).replaceAll(databaseUrl, "<private-test-db>")
        ).join(" | ")
    );

    verification = await openScriptDatabase({
      appEnvironment: "test",
      databaseDriver: "postgres",
      databaseUrl,
      releaseSha
    });
    const migrationFiles = await listMigrations();
    assert.equal(migrationFiles.length, 139, "Canonical migration set changed");
    const status = await migrationStatus(verification);
    assert.equal(status.length, 139);
    assert(status.every((row) => row.applied && row.checksumMatches));
    const rows = await verification.query("SELECT COUNT(*)::int AS count FROM hse_schema_migrations");
    assert.equal(rows.rows[0].count, 139, "Migration ledger has duplicates or lost entries");
  } finally {
    if (verification) await verification.close();
    try {
      if (created) await admin.unsafe("DROP DATABASE " + quotedName + " WITH (FORCE)");
    } finally {
      await admin.end({ timeout: 5 });
    }
  }
});
