import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("M2.01 runtime acceptance command passes through its production runtime harness", () => {
  const result = spawnSync(process.execPath, ["scripts/run-assurance-order-case-runtime-tests.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "M2.01 runtime harness failed"
  );
});
