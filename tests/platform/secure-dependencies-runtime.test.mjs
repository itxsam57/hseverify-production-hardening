import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { checkLockedDependencyFloors } from "../../src/lib/security/dependency-floor-service.ts";

test("application dependency floor service exposes locked production dependency state", () => {
  const result = checkLockedDependencyFloors();

  assert.ok(result.length > 0);
  assert.ok(result.every((dependency) => dependency.passed));
});

test("security floor checker executes against the repository lockfile", () => {
  const output = execFileSync("node", ["scripts/check-secure-dependencies.mjs"], {
    encoding: "utf8"
  });

  assert.match(output, /Locked production transitive dependencies meet the recorded security floors\./);
});
