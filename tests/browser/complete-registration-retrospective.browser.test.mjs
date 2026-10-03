import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function execute(script, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script], { env, stdio: ["ignore", "inherit", "inherit"] });
    p.once("error", reject);
    p.once("exit", code => code === 0 ? resolve() : reject(new Error(script + " exited " + code)));
  });
}

test("Fresh Worker and Company registration, evidence, Admin verification, workforce, order, policy and question authoring journeys", { timeout: 600000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "hse-complete-retrospective-"));
  const port = await freePort();
  const env = {
    ...process.env, HSE_APP_ENV: "development", HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: dir, HSE_RELEASE_SHA: "complete-retrospective",
    HSE_SESSION_SECRET: "complete-retrospective-session-secret-2026-more-than-32",
    HSE_AUTH_PEPPER: "complete-retrospective-auth-pepper-2026-more-than-32",
    HSE_ENABLE_AUTH_SANDBOX: "true", HSE_AUTH_SANDBOX_ACCESS_KEY: "complete-retrospective-sandbox-access-2026-more-than-32",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false",
    HSE_BROWSER_BASE_URL: `http://127.0.0.1:${port}`,
    HSE_BROWSER_ARTIFACT_ROOT: ".autopilot/artifacts/complete-retrospective"
  };
  try {
    const m = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], { env, encoding: "utf8" });
    assert.equal(m.status, 0, m.stderr || m.stdout);
    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: env.HSE_BROWSER_BASE_URL + "/worker/register", projectRoot: process.cwd(), environment: env,
      probe: async () => {
        for (const script of ["scripts/hard-browser-retrospective.mjs", "scripts/hard-browser-retrospective-worker-evidence.mjs", "scripts/hard-browser-retrospective-company-registration.mjs"]) await execute(script, env);
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
