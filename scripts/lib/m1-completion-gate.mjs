import assert from "node:assert/strict";

/** Owner-approved 2026-11-20 M1-first queue rule; final release attestation semantics unchanged. */
export function assertM1CompletionBeforeAdvance(scenarios, focusId) {
  assert(Array.isArray(scenarios), "Expected canonical 218 scenario ledger");
  assert(typeof focusId === "string" && focusId.length > 0, "Expected active scenario ID");
  const m1 = scenarios.filter(row => row.id.startsWith("M1."));
  assert.equal(m1.length, 67, "Frozen M1 scenario count changed");
  const fullyVerified = m1.filter(row => row.status === "FULLY_VERIFIED").length;
  assert(fullyVerified === 67 || focusId.startsWith("M1."),
    `Owner M1 completion gate: ${67 - fullyVerified} M1 scenarios remain uncertified; cannot focus ${focusId}`);
  return { fullyVerified, total: 67, remaining: 67 - fullyVerified };
}
