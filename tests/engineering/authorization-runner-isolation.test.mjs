import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

function runAuthorizationTests(delayMs = 0) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.HSE_AUTHORIZATION_TEST_DIST;
      const child = spawn(process.execPath, ["scripts/run-authorization-tests.mjs"], {
        cwd: process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, output }));
    }, delayMs);
  });
}

test(
  "authorization test runners isolate compiled modules across concurrent invocations",
  { timeout: 30_000 },
  async () => {
    const [first, second] = await Promise.all([
      runAuthorizationTests(),
      runAuthorizationTests(100)
    ]);

    assert.equal(
      first.code,
      0,
      `first concurrent authorization runner failed (${first.signal ?? "no signal"}):\n${first.output}`
    );
    assert.equal(
      second.code,
      0,
      `second concurrent authorization runner failed (${second.signal ?? "no signal"}):\n${second.output}`
    );
  }
);
