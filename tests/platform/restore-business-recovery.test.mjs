import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("cold database and private object restore recovers the Worker assessment and evidence", () => {
  const result = spawnSync(process.execPath, ["scripts/run-m3-11-restore-drill.mjs"], {
    encoding: "utf8", timeout: 180_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.equal(receipt.status, "PASS");
  assert.deepEqual(receipt.businessRecovery, {
    committedAnswer: true,
    nextQuestionDraft: true,
    pinnedQuestionHistory: true,
    versionedEvidence: true,
    privateObjectDigest: true,
    permanentWorkerId: true,
    foreignWorkerDenied: true,
  }, "marker-only recovery does not prove restoration of the actual Worker journey");
});
