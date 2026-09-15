import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLockedDependencyFloors } from "../../src/lib/security/dependency-floor-service.ts";

test("dependency floor boundary rejects invalid untrusted lock input", () => {
  const path = join(tmpdir(), `hse-invalid-lock-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify([]));

  assert.throws(
    () => checkLockedDependencyFloors(path),
    /Dependency lock boundary rejected invalid lock data/
  );
});

test("dependency floor does not authorize missing packages", () => {
  const path = join(tmpdir(), `hse-missing-lock-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({ packages: {} }));

  const result = checkLockedDependencyFloors(path);

  assert.ok(result.some((dependency) => dependency.passed === false));
});
