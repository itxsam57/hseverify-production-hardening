import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const SHA = "3673fc42b54df50a2bd145743b04f8b63a1a445d";
const TOKEN = "m312-readiness-probe-private-key-00000000000000000";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("no TCP port"));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
function environment(overrides = {}) {
  return {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    HSE_APP_ENV: "development",
    HSE_RELEASE_SHA: SHA,
    HSE_SESSION_SECRET: "m312-readiness-test-only-session-secret-000000000000",
    HSE_AUTH_PEPPER: "m312-readiness-test-only-auth-pepper-0000000000000",
    HSE_MONITOR_PROBE_TOKEN: TOKEN,
    HSE_ENABLE_AUTH_SANDBOX: "false",
    ...overrides
  };
}
async function withServer(env, runner) {
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const result = await runDevelopmentServer({
    args: ["--hostname", "127.0.0.1", "--port", String(port)],
    probeUrl: baseUrl + "/admin/login",
    projectRoot: process.cwd(), environment: env,
    probe: async ({ initialResponse, output }) => {
      assert.equal(initialResponse.status, 200, output());
      await runner(baseUrl);
    }
  });
  assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
}

test("M3.12 actual Next readiness route requires bearer and proves DB connectivity only on pinned SHA", { timeout: 180_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "hse-m312-ready-"));
  const env = environment({ HSE_DATABASE_DRIVER: "pglite", HSE_PGLITE_DATA_DIR: dataDir });
  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: process.cwd(), env, encoding: "utf8", timeout: 120_000
    });
    assert.equal(migration.status, 0, String(migration.stderr ?? "").slice(-1200));
    await withServer(env, async baseUrl => {
      const url = baseUrl + "/api/operations/readiness";
      const denied = await fetch(url, { redirect: "manual" });
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("cache-control")?.includes("no-store"), true);
      assert.deepEqual(await denied.json(), { status: "unauthorized" });
      const wrong = await fetch(url, { headers: { Authorization: "Bearer wrong" }, redirect: "manual" });
      assert.equal(wrong.status, 401);
      const accepted = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN }, redirect: "manual" });
      assert.equal(accepted.status, 200);
      assert(accepted.headers.get("vary")?.split(",").map(value => value.trim()).includes("Authorization"));
      assert.deepEqual(await accepted.json(), {
        status: "ready", scope: "database_connection_only", releaseSha: SHA
      });
      const invalidMethod = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + TOKEN } });
      assert.equal(invalidMethod.status, 405);
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("M3.12 actual Next readiness route fails closed on unavailable PostgreSQL and no probe token", { timeout: 180_000 }, async () => {
  const env = environment({
    HSE_DATABASE_DRIVER: "postgres",
    DATABASE_URL: "postgres://m312@127.0.0.1:1/not-running",
    HSE_MONITOR_PROBE_TOKEN: TOKEN
  });
  await withServer(env, async baseUrl => {
    const url = baseUrl + "/api/operations/readiness";
    const failed = await fetch(url, { headers: { Authorization: "Bearer " + TOKEN } });
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { status: "unavailable" });
  });
  await withServer(environment({
    HSE_DATABASE_DRIVER: "postgres",
    DATABASE_URL: "postgres://m312@127.0.0.1:1/not-running",
    HSE_MONITOR_PROBE_TOKEN: ""
  }), async baseUrl => {
    const unavailable = await fetch(baseUrl + "/api/operations/readiness");
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { status: "unavailable" });
  });
});
