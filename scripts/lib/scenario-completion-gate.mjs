import assert from "node:assert/strict";

/** Ordered original 218-case queue. Historical scoped passes never count as full closure. */
export function assertScenarioClosureBeforeAdvance(scenarios, focusId) {
  assert.equal(scenarios.length, 218, "Original frozen scenario queue changed");
  const m1 = scenarios.filter(row => row.id.startsWith("M1."));
  assert.equal(m1.length, 67, "Frozen M1 scenario count changed");
  const firstUnfinished = scenarios.find(row => row.status !== "FULLY_VERIFIED");
  const expected = firstUnfinished?.id ?? scenarios.at(-1).id;
  assert.equal(focusId, expected,
    `Finish and certify ${expected} before changing focus to ${focusId}`);
  const fullyVerified = m1.filter(row => row.status === "FULLY_VERIFIED").length;
  return { fullyVerified, total: 67, remaining: 67 - fullyVerified };
}
