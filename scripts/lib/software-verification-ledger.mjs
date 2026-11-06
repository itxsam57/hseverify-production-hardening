import assert from "node:assert/strict";

const CASES = ["positive", "invalid_input", "permission_isolation", "retry_recovery", "persistence", "downstream_outcome"];
const STATUSES = new Set(["UNREVIEWED", "PARTIAL", "FAILED", "SOFTWARE_VERIFIED", "STALE"]);
const hash = /^[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{40}$/;

function reviewed(review, label) {
  assert.equal(review?.disposition, "ACCEPTED", label + " requires accepted independent review");
  assert.ok(review.reviewer && review.builder && review.reviewer !== review.builder,
    label + " requires distinct reviewer and builder identities");
  assert.ok(review.artifact, label + " needs the retained review reference");
  assert.match(review.artifact_sha256 ?? "", hash, label + " needs the review artifact digest");
}

export function validateSoftwareVerificationPhase(matrix) {
  const phase = matrix.software_verification_phase;
  assert.ok(phase, "A current software verification phase must be explicitly contracted");
  assert.equal(matrix.scenarios.length, 218);
  assert.equal(phase.batches.length, 10);
  const assigned = phase.batches.flatMap(batch => batch.scenario_ids);
  assert.equal(assigned.length, 218);
  assert.equal(new Set(assigned).size, 218);
  assert.deepEqual([...assigned].sort(), matrix.scenarios.map(row => row.id).sort());
  assert.equal(new Set(matrix.scenarios.map(row => row.brick)).size, 37);
  assert.deepEqual(phase.required_cases, CASES);
  assert.equal(phase.production_activation, "DEFERRED_BY_OWNER");
  for (const batch of phase.batches) {
    const rows = matrix.scenarios.filter(row => batch.scenario_ids.includes(row.id));
    assert.equal(batch.scenario_count, rows.length);
    assert.deepEqual([...new Set(rows.map(row => row.brick))].sort(), [...batch.bricks].sort());
  }
  const counts = {};
  for (const row of matrix.scenarios) {
    const result = row.software_verification;
    assert.ok(result, row.id + " needs a software verification disposition");
    assert.ok(STATUSES.has(result.status), row.id + " has an invalid software status");
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    assert.ok(result.case_plan, row.id + " needs a case-design task");
    if (result.status !== "SOFTWARE_VERIFIED") continue;
    assert.match(result.source_sha ?? "", sha);
    assert.match(result.product_tree_sha256 ?? "", hash);
    assert.equal(result.case_plan.status, "ACCEPTED");
    reviewed(result.case_plan.review, row.id + " variant plan");
    reviewed(result.review, row.id + " completed evidence");
    const variants = result.case_plan.variants;
    assert.ok(Array.isArray(variants) && variants.length > 0);
    assert.equal(new Set(variants.map(variant => variant.id)).size, variants.length);
    for (const variant of variants) {
      assert.ok(CASES.includes(variant.category));
      assert.ok(variant.action?.length > 10 && variant.expected_outcome?.length > 10,
        row.id + " needs concrete actions and expected outcomes");
      assert.ok(variant.runtime, row.id + " must identify the execution boundary");
    }
    for (const name of CASES) {
      const evidence = result.cases?.[name];
      assert.ok(evidence, row.id + " is missing " + name);
      reviewed(evidence.review, row.id + " " + name);
      if (evidence.result === "NOT_APPLICABLE") {
        assert.notEqual(name, "positive", row.id + " must exercise its positive software behavior");
        assert.ok(evidence.reason?.length > 20, row.id + " needs a specific exception rationale");
        assert.equal(variants.filter(variant => variant.category === name).length, 0,
          row.id + " cannot waive a planned variant");
        continue;
      }
      assert.equal(evidence.result, "PASS");
      assert.equal(evidence.source_sha, result.source_sha);
      assert.equal(evidence.product_tree_sha256, result.product_tree_sha256);
      assert.ok(evidence.artifact);
      assert.match(evidence.artifact_sha256 ?? "", hash);
      assert.ok(evidence.assertion?.length > 10);
      const expected = variants.filter(variant => variant.category === name).map(variant => variant.id).sort();
      assert.ok(expected.length > 0, row.id + " " + name + " needs planned variants");
      assert.deepEqual([...(evidence.variant_ids ?? [])].sort(), expected,
        row.id + " must prove every planned variant");
    }
  }
  return { scenarios: matrix.scenarios.length, batches: phase.batches.length, counts };
}
