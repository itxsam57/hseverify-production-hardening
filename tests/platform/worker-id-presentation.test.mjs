import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const {
  isPermanentWorkerId,
  workerIdPresentation
} = loadTs("src/lib/worker/worker-id-presentation.ts");

test("Worker ID presentation distinguishes provisional registration references", () => {
  const provisional = workerIdPresentation("HSE-REG-ABC123");
  assert.equal(provisional.permanent, false);
  assert.equal(provisional.label, "Registration reference");
  assert.match(provisional.helper, /provisional onboarding reference/i);
  assert.equal(isPermanentWorkerId("HSE-REG-ABC123"), false);
});

test("Worker ID presentation labels canonical permanent identifiers correctly", () => {
  const canonical = "worker_id_" + "A".repeat(24);
  const legacy = "HSE-WRK-ABC-123";
  assert.equal(isPermanentWorkerId(canonical), true);
  assert.equal(isPermanentWorkerId(legacy), true);
  assert.equal(workerIdPresentation(canonical).label, "Permanent Worker ID");
});
