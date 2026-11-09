import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDevelopmentServer } from "./lib/development-server.mjs";
const root = process.cwd();
const dataDir = await mkdtemp(join(tmpdir(), "hse-a24-burst-"));
const sandboxKey = randomBytes(28).toString("hex");
const env = {
  ...process.env, HSE_APP_ENV: "development", HSE_DATABASE_DRIVER: "pglite",
  HSE_PGLITE_DATA_DIR: dataDir,
  HSE_RELEASE_SHA: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  HSE_SESSION_SECRET: randomBytes(48).toString("hex"),
  HSE_AUTH_PEPPER: randomBytes(48).toString("hex"),
  HSE_ENABLE_AUTH_SANDBOX: "true",
  HSE_AUTH_SANDBOX_ACCESS_KEY: sandboxKey,
  HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false",
  HSE_BURST_ARTIFACT_DIR: ".autopilot/artifacts",
  UV_THREADPOOL_SIZE: "2", NODE_OPTIONS: "--max-old-space-size=4096"
};
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}
function invokeChild(argv, options) {
  return new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, argv, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveChild({ code, signal }));
  });
}
try {
  const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {cwd: root, env, encoding:"utf8"});
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);
  console.log("A24 fresh isolated PGlite migrations applied; no production DB.");
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;
  await runDevelopmentServer({
    projectRoot:root, args:["--hostname","127.0.0.1","--port",String(port)],
    probeUrl:base + "/worker/register", environment:env,
    probe:async({output}) => {
      console.log("A24 audited authenticated 50-request mixed-role browser subprocess started.");
      const result = await invokeChild(["scripts/hard-browser-mixed-role-burst.mjs"], {cwd:root,env:{...env,HSE_BROWSER_BASE_URL:base}});
      console.log("A24 burst subprocess result",JSON.stringify(result));
      if(result.code!==0)throw Error("Authenticated burst failed. Server tail: "+output().slice(-2200));
    }
  });
  console.log("A24 audited authenticated 50-request mixed-role test completed, server stopped.");
} finally {
  await rm(dataDir,{recursive:true,force:true});
}
