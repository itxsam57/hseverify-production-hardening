import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSoftwareVerificationPhase } from "../../scripts/lib/software-verification-ledger.mjs";

const matrix = JSON.parse(readFileSync("docs/qa/2026-10-02-evidence.json", "utf8")).expanded_scenario_verification;

// Schema-only fixtures exercise the promotion gate. They never update the actual ledger.
function acceptedSchemaFixture() {
  const candidate = structuredClone(matrix);
  const row = candidate.scenarios[0];
  const review = { disposition: "ACCEPTED", reviewer: "unit-reviewer", builder: "unit-builder",
    artifact: "unit-fixture-review", artifact_sha256: "a".repeat(64) };
  const variants = candidate.software_verification_phase.required_cases.map(category => ({
    id: row.id + "." + category, category,
    action: "Execute the isolated schema fixture for " + category,
    expected_outcome: "The declared schema fixture outcome is retained for " + category,
    runtime: "schema-unit-test"
  }));
  const result = row.software_verification;
  Object.assign(result, {
    status: "SOFTWARE_VERIFIED", source_sha: "b".repeat(40),
    product_tree_sha256: "c".repeat(64), review,
    case_plan: { status: "ACCEPTED", variants, production_deferred: [], review }
  });
  for (const variant of variants) {
    result.cases[variant.category] = {
      result: "PASS", source_sha: result.source_sha, product_tree_sha256: result.product_tree_sha256,
      artifact: "unit-fixture-result", artifact_sha256: "d".repeat(64),
      assertion: "Schema fixture proves the declared validation shape",
      variant_ids: [variant.id], review
    };
  }
  return candidate;
}

test("software plan assigns all 218 scenarios and 37 bricks", () => {
  assert.equal(validateSoftwareVerificationPhase(matrix).scenarios, 218);
});

test("accepted schema fixture passes the structural gate", () => {
  assert.equal(validateSoftwareVerificationPhase(acceptedSchemaFixture()).counts.SOFTWARE_VERIFIED, 1);
});

test("scenario promotion requires independent review of the plan and every case", () => {
  for (const target of ["plan", "scenario", ...matrix.software_verification_phase.required_cases]) {
    const candidate = acceptedSchemaFixture();
    const result = candidate.scenarios[0].software_verification;
    if (target === "plan") delete result.case_plan.review;
    else if (target === "scenario") delete result.review;
    else delete result.cases[target].review;
    assert.throws(() => validateSoftwareVerificationPhase(candidate), /independent review/);
  }
});

test("self-review cannot approve software evidence", () => {
  const candidate = acceptedSchemaFixture();
  candidate.scenarios[0].software_verification.review.reviewer = "unit-builder";
  assert.throws(() => validateSoftwareVerificationPhase(candidate), /distinct reviewer and builder/);
});

test("every concrete variant must have executed evidence", () => {
  const candidate = acceptedSchemaFixture();
  candidate.scenarios[0].software_verification.cases.positive.variant_ids = [];
  assert.throws(() => validateSoftwareVerificationPhase(candidate), /every planned variant/);
});

test("positive software behavior cannot be waived", () => {
  const candidate = acceptedSchemaFixture();
  const result = candidate.scenarios[0].software_verification;
  result.case_plan.variants = result.case_plan.variants.filter(variant => variant.category !== "positive");
  Object.assign(result.cases.positive, { result: "NOT_APPLICABLE", reason: "A schema fixture attempts to waive all positive behavior." });
  assert.throws(() => validateSoftwareVerificationPhase(candidate), /positive software behavior/);
});

test("duplicate assignments and missing dispositions are rejected", () => {
  const duplicate = structuredClone(matrix);
  duplicate.software_verification_phase.batches[1].scenario_ids[0] =
    duplicate.software_verification_phase.batches[0].scenario_ids[0];
  assert.throws(() => validateSoftwareVerificationPhase(duplicate));
  const missing = structuredClone(matrix);
  delete missing.scenarios[0].software_verification;
  assert.throws(() => validateSoftwareVerificationPhase(missing), /disposition/);
});
