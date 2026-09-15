import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseReadinessSnapshot
} from "../../src/lib/operations/production-launch-domain.ts";

const completeChecks = (status = "passed") => [
  { name: "runbook", status },
  { name: "support", status },
  { name: "alerts", status },
  { name: "rollback", status },
  { name: "acceptance", status }
];

test("M3.12 release readiness stays in attention until every persisted handover check passes", () => {
  const snapshot = buildReleaseReadinessSnapshot([
    { name: "runbook", status: "passed" },
    { name: "support", status: "passed" },
    { name: "alerts", status: "failed" },
    { name: "rollback", status: "pending" },
    { name: "acceptance", status: "passed" }
  ]);

  assert.equal(snapshot.status, "attention");
  assert.deepEqual(snapshot.checks.map((check) => check.status), [
    "passed",
    "passed",
    "failed",
    "pending",
    "passed"
  ]);
});

test("M3.12 release readiness becomes ready only when every handover check passes", () => {
  const snapshot = buildReleaseReadinessSnapshot(completeChecks());
  assert.equal(snapshot.status, "ready");
});

test("M3.12 release readiness rejects missing, duplicate, and invalid handover checks", () => {
  assert.throws(
    () => buildReleaseReadinessSnapshot([{ name: "runbook", status: "passed" }]),
    /exactly one status for every required release handover check/
  );
  assert.throws(
    () => buildReleaseReadinessSnapshot([
      ...completeChecks(),
      { name: "runbook", status: "passed" }
    ]),
    /exactly one status for every required release handover check/
  );
  assert.throws(
    () => buildReleaseReadinessSnapshot([
      ...completeChecks().slice(0, 4),
      { name: "acceptance", status: "unknown" }
    ]),
    /release handover status is invalid/
  );
});
