import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { openScriptDatabase } from "./lib/database.mjs";
import { applyPendingMigrations } from "./lib/migrations.mjs";
import {
  assertProjectConfigurationUnchanged,
  cleanNextMode,
  prepareNextMode,
  snapshotProjectConfiguration
} from "./lib/next-build-system.mjs";

const SESSION_SECRET =
  "runtime-smoke-session-secret-with-at-least-thirty-two-characters";
const AUTH_PEPPER =
  "runtime-smoke-auth-pepper-with-at-least-thirty-two-characters";
const WORKER_EMAIL = "runtime@example.com";
const WORKER_SUB = `worker:${WORKER_EMAIL}`;
const WORKER_ID = "HSE-WRK-RUNTIME-0001";
const RELEASE_SHA = "runtime-smoke-release";
const DATA_DIRECTORY = resolve(
  process.cwd(),
  ".data",
  "runtime smoke",
  "existing migrated database"
);

async function removeDirectory(path) {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 150
  });
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a runtime smoke-test port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    delay(timeoutMs).then(() => false)
  ]);
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const taskkill = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true }
    );
    await waitForExit(taskkill, 10_000);
    await waitForExit(child, 10_000);
    return;
  }
  child.kill("SIGTERM");
  if (!(await waitForExit(child, 10_000))) {
    child.kill("SIGKILL");
    await waitForExit(child, 5_000);
  }
}

async function waitForServer(url, child, output) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Next development server exited early.\n${output.join("")}`);
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Startup is still in progress.
    }
    await delay(500);
  }
  throw new Error(`Next development server did not become ready.\n${output.join("")}`);
}

function persistedProfile() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    workerSub: WORKER_SUB,
    workerId: WORKER_ID,
    version: 1,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    sensitiveFieldsLocked: false,
    personal: {
      legalFirstName: "Persisted",
      legalLastName: "Runtime",
      preferredName: "Persisted Runtime Worker",
      dateOfBirth: "1990-01-01",
      nationality: "Test Nation",
      countryOfResidence: "Test Country",
      primaryLanguage: "English"
    },
    contact: {
      phoneCountryCode: "",
      phoneNumber: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      region: "",
      postalCode: ""
    },
    professional: {
      primaryOccupation: "",
      yearsExperience: null,
      employmentStatus: "",
      willingToRelocate: false,
      preferredWorkCountries: ""
    },
    correctionRequest: null,
    audit: []
  };
}

const databaseEnvironment = {
  appEnvironment: "development",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: DATA_DIRECTORY,
  releaseSha: RELEASE_SHA,
  sessionSecret: SESSION_SECRET,
  authPepper: AUTH_PEPPER,
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function prepareExistingDatabase() {
  const database = await openScriptDatabase(databaseEnvironment);
  try {
    await applyPendingMigrations(database, RELEASE_SHA);
    const profile = persistedProfile();
    await database.query(
      `INSERT INTO worker_profiles (
         worker_sub, worker_id, schema_version, version, status,
         profile_document, created_at, updated_at, submitted_at
       ) VALUES ($1, $2, 1, 1, 'draft', $3::jsonb, $4, $4, NULL)`,
      [WORKER_SUB, WORKER_ID, JSON.stringify(profile), profile.createdAt]
    );
  } finally {
    await database.close();
  }
}

async function verifyDatabaseWasNotReset() {
  const database = await openScriptDatabase(databaseEnvironment);
  try {
    const result = await database.query(
      `SELECT version, profile_document
       FROM worker_profiles
       WHERE worker_sub = $1`,
      [WORKER_SUB]
    );
    assert.equal(
      result.rows.length,
      1,
      "The existing Worker Profile must remain present."
    );
    assert.equal(
      Number(result.rows[0].version),
      1,
      "The runtime must not reset the profile version."
    );
  } finally {
    await database.close();
  }
}

function assertPortalRedirect(response, expectedPath) {
  assert.ok(
    [303, 307, 308].includes(response.status),
    `Expected a redirect, received HTTP ${response.status}.`
  );
  const location = response.headers.get("location");
  assert.ok(location, "Protected portal redirect must include Location.");
  assert.equal(new URL(location, "http://localhost").pathname, expectedPath);
}

const projectRoot = process.cwd();
await removeDirectory(DATA_DIRECTORY);
const snapshot = await snapshotProjectConfiguration(projectRoot);
const mode = await prepareNextMode("runtime-smoke", projectRoot);
let child;

try {
  await prepareExistingDatabase();
  const port = await findFreePort();
  const output = [];
  const nextBin = resolve(
    projectRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  );

  child = spawn(
    process.execPath,
    [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...mode.environment,
        NEXT_TELEMETRY_DISABLED: "1",
        HSE_APP_ENV: "development",
        HSE_RELEASE_SHA: RELEASE_SHA,
        HSE_DEPLOYMENT_ID: RELEASE_SHA,
        HSE_SESSION_SECRET: SESSION_SECRET,
        HSE_AUTH_PEPPER: AUTH_PEPPER,
        HSE_DATABASE_DRIVER: "pglite",
        HSE_PGLITE_DATA_DIR: DATA_DIRECTORY,
        HSE_ENABLE_WORKER_DEMO_AUTH: "false",
        HSE_USE_WORKER_DEMO_DATA: "false",
        HSE_ENABLE_AUTH_SANDBOX: "false"
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );

  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const origin = `http://127.0.0.1:${port}`;
  await waitForServer(`${origin}/worker/login`, child, output);
  await stat(mode.distDir);

  const workerLogin = await fetch(`${origin}/worker/login`);
  const workerLoginHtml = await workerLogin.text();
  assert.equal(workerLogin.status, 200, workerLoginHtml);
  assert.match(workerLoginHtml, /Worker/);
  assert.match(workerLoginHtml, /sign in/i);
  assert.match(workerLoginHtml, /Create a Worker account/);
  assert.doesNotMatch(workerLoginHtml, /Temporary problem/);

  const workerDashboard = await fetch(`${origin}/worker/dashboard`, {
    redirect: "manual"
  });
  assertPortalRedirect(workerDashboard, "/worker/login");

  const workerProfile = await fetch(`${origin}/worker/profile`, {
    redirect: "manual"
  });
  assertPortalRedirect(workerProfile, "/worker/login");

  const companyDashboard = await fetch(`${origin}/company/dashboard`, {
    redirect: "manual"
  });
  assertPortalRedirect(companyDashboard, "/company/login");

  await stopProcessTree(child);
  child = undefined;
  await verifyDatabaseWasNotReset();
  await assertProjectConfigurationUnchanged(snapshot, projectRoot);

  console.log(
    "Application PGlite runtime smoke passed with existing data preserved, protected portal redirects, isolated Next output and unchanged source configuration."
  );
} finally {
  await stopProcessTree(child);
  await delay(250);
  await cleanNextMode("runtime-smoke", projectRoot);
  await removeDirectory(DATA_DIRECTORY);
}
