import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

function runAssessmentTests(args, delayMs = 0) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const child = spawn(
        process.execPath,
        ["scripts/run-assessment-attempt-tests.mjs", ...args],
        {
          cwd: process.cwd(),
          env,
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
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
  "assessment runtime test runners isolate generated modules across concurrent invocations",
  { timeout: 60_000 },
  async () => {
    const [fullRecovery, beginOnly] = await Promise.all([
      runAssessmentTests(["--m2-08"]),
      runAssessmentTests(["--begin"], 700)
    ]);

    assert.equal(
      beginOnly.code,
      0,
      `short concurrent runner failed (${beginOnly.signal ?? "no signal"}):\n${beginOnly.output}`
    );
    assert.equal(
      fullRecovery.code,
      0,
      `long concurrent runner failed (${fullRecovery.signal ?? "no signal"}):\n${fullRecovery.output}`
    );
  }
);
