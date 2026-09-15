import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { assertIndependentReview } = loadTs("src/lib/credential/credential-appeals-domain.ts");

test("M3.07 requires independent appeal review", () => {
  assert.doesNotThrow(() => assertIndependentReview("accepted", "reviewer_1", "worker_1"));
  assert.throws(() => assertIndependentReview("accepted", "worker_1", "worker_1"));
  assert.throws(() => assertIndependentReview("accepted", "", "worker_1"));
});
