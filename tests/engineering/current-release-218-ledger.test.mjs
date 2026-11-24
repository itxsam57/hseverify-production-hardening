import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  FROZEN_MASTERPLAN_DIGEST,
  buildCurrentReleaseLedger
} from "../../scripts/lib/current-release-218-ledger.mjs";
import { assertScenarioClosureBeforeAdvance } from "../../scripts/lib/scenario-completion-gate.mjs";

const source = JSON.parse(readFileSync("docs/qa/2026-10-02-evidence.json", "utf8"));
const SOURCE_SHA = "b54421302fe7000c0284864b92cbff258c2903a0";
const frozen = source.expanded_scenario_verification.scenarios;
const copy = (value) => JSON.parse(JSON.stringify(value));

test("218 frozen scenarios and 37 bricks reconcile at current SHA without historical test logs", () => {
  const report = buildCurrentReleaseLedger({ source, commitSha: SOURCE_SHA });
  assert.equal(report.exact_sha, SOURCE_SHA);
  assert.equal(report.frozen_fingerprint_sha256, FROZEN_MASTERPLAN_DIGEST);
  assert.equal(report.counts.total, 218);
  assert.equal(report.counts.full_verified, 0);
  assert.equal(report.release.decision, "NO_GO");
  assert.equal(report.scenarios.length, 218);
  assert.equal(new Set(report.scenarios.map(row => row.id)).size, 218);
  assert.equal(new Set(report.scenarios.map(row => row.brick)).size, 37);
  assert(report.scenarios.every(row => row.evidence.current_sha.length === 0));
  assert(report.scenarios.every(row => row.exact_sha === SOURCE_SHA));
  assert(report.scenarios.every(row => row.missing_acceptance.length >= 6));
  assert(report.scenarios.every(row => row.status !== "FULLY_VERIFIED"));
  // M1-first policy is fail-closed without manufacturing any release certification.
  const m1 = report.scenarios.filter(row => row.id.startsWith("M1."));
  assert.deepEqual(assertScenarioClosureBeforeAdvance(report.scenarios, "M1.01.01"),
    { fullyVerified: 0, total: 67, remaining: 67 });
  // Also gate the actual tracked execution cursor so CI fails if future work silently jumps back to M2.
  const actualCursor = JSON.parse(readFileSync("docs/qa/218_VERTICAL_EXECUTION_CURSOR.json", "utf8"));
  assertScenarioClosureBeforeAdvance(report.scenarios, actualCursor.current_focus_scenario_id);
  assert.throws(() => assertScenarioClosureBeforeAdvance(report.scenarios, "M2.01.05"),
    /M1.01.01/);
  const nearlyCertified = report.scenarios.map(row => row.id === m1[66].id ?
    row : row.id.startsWith("M1.") ? { ...row, status: "FULLY_VERIFIED" } : row);
  assert.throws(() => assertScenarioClosureBeforeAdvance(nearlyCertified, "M2.01.05"),
    /M1.12.05/);
  const allM1Certified = report.scenarios.map(row => row.id.startsWith("M1.") ?
    { ...row, status: "FULLY_VERIFIED" } : row);
  assert.throws(() => assertScenarioClosureBeforeAdvance(allM1Certified, "M2.01.05"),
    /M2.01.01/);
  assert.deepEqual(assertScenarioClosureBeforeAdvance(allM1Certified, "M2.01.01"),
    { fullyVerified: 67, total: 67, remaining: 0 });
  // The next M1 ID is blocked until its predecessor has final evidence.
  assert.throws(() => assertScenarioClosureBeforeAdvance(report.scenarios, "M1.02.01"),
    /M1.01.01/);
  const afterFirst = report.scenarios.map((row, index) => index === 0 ?
    { ...row, status: "FULLY_VERIFIED" } : row);
  assert.deepEqual(assertScenarioClosureBeforeAdvance(afterFirst, "M1.01.02"),
    { fullyVerified: 1, total: 67, remaining: 66 });
  assert.throws(() => assertScenarioClosureBeforeAdvance(afterFirst, "M1.01.03"),
    /M1.01.02/);
  const allCertified = report.scenarios.map(row => ({ ...row, status: "FULLY_VERIFIED" }));
  assert.deepEqual(assertScenarioClosureBeforeAdvance(allCertified, report.scenarios.at(-1).id),
    { fullyVerified: 67, total: 67, remaining: 0 });
});

test("historical PASSED and PARTIAL cannot be promoted into current release certification", () => {
  const report = buildCurrentReleaseLedger({ source, commitSha: SOURCE_SHA });
  const oldPassed = frozen.filter(row => row.status === "passed");
  const oldPartial = frozen.filter(row => row.status === "partially-verified");
  assert(oldPassed.length > 0 && oldPartial.length > 0);
  assert(report.scenarios.filter(row => row.historical.status === "passed").length === oldPassed.length);
  assert(report.scenarios.filter(row => row.historical.status === "partially-verified").length === oldPartial.length);
  for (const row of report.scenarios) {
    assert.equal(row.historical.is_current_candidate_evidence, false);
    assert.notEqual(row.status, "FULLY_VERIFIED");
  }
});

test("known unavailable providers and stage are explicitly BLOCKED_EXTERNAL, not PASS", () => {
  const report = buildCurrentReleaseLedger({ source, commitSha: SOURCE_SHA });
  const byId = new Map(report.scenarios.map(row => [row.id, row]));
  for (const id of ["M3.10.01", "M3.10.02", "M3.10.03", "M3.10.04", "M3.10.05", "M3.12.02", "M3.12.03", "M3.12.04"]) {
    assert.equal(byId.get(id).status, "BLOCKED_EXTERNAL", id);
    assert(byId.get(id).blockers.length >= 1, id);
  }
  assert.equal(byId.get("M3.12.01").status, "IN_PROGRESS");
  assert(Object.values(report.release.required_gates).every(value => value === "NOT_VERIFIED"));
  assert.equal(report.release.decision, "NO_GO");
});

test("wrong number, duplicate scenario, brick drift and altered scenario text fail closed", () => {
  const missing = copy(source);
  missing.expanded_scenario_verification.scenarios.pop();
  assert.throws(() => buildCurrentReleaseLedger({ source: missing, commitSha: SOURCE_SHA }), /218/);
  const dup = copy(source);
  dup.expanded_scenario_verification.scenarios[1].id = dup.expanded_scenario_verification.scenarios[0].id;
  assert.throws(() => buildCurrentReleaseLedger({ source: dup, commitSha: SOURCE_SHA }), /unique|frozen/i);
  const brick = copy(source);
  brick.expanded_scenario_verification.scenarios[0].brick = "FAKE";
  assert.throws(() => buildCurrentReleaseLedger({ source: brick, commitSha: SOURCE_SHA }), /frozen|fingerprint|brick/i);
  const text = copy(source);
  text.expanded_scenario_verification.scenarios[0].scenario = "fake certification";
  assert.throws(() => buildCurrentReleaseLedger({ source: text, commitSha: SOURCE_SHA }), /frozen|fingerprint/i);
  const family = copy(source);
  family.expanded_scenario_verification.scenarios[0].family = "Fake family";
  assert.throws(() => buildCurrentReleaseLedger({ source: family, commitSha: SOURCE_SHA }), /frozen|fingerprint/i);
});

test("no fabricated current git commit, invalid roles, or forged source fields", () => {
  assert.throws(() => buildCurrentReleaseLedger({ source, commitSha: "fake-sha" }), /SHA/);
  const roles = copy(source);
  roles.expanded_scenario_verification.scenarios[0].roles = ["superuser"];
  assert.throws(() => buildCurrentReleaseLedger({ source: roles, commitSha: SOURCE_SHA }), /role|frozen/i);
  const fake = copy(source);
  fake.expanded_scenario_verification.scenarios[0].status = "FULLY_VERIFIED";
  assert.throws(() => buildCurrentReleaseLedger({ source: fake, commitSha: SOURCE_SHA }), /historical|status/i);
});

test("actual clean-worktree CLI produces readable no-go 218-row ledger with git SHA, no old A26 files", () => {
  const result = spawnSync(process.execPath, ["scripts/reconcile-current-release-218.mjs"], {
    encoding: "utf8", timeout: 30_000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.frozen_scenarios, 218);
  assert.equal(summary.fully_verified, 0);
  assert.equal(summary.release_decision, "NO_GO");
  assert(existsSync(summary.artifact));
  const report = JSON.parse(readFileSync(summary.artifact, "utf8"));
  const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(report.exact_sha, git.stdout.trim());
  assert.equal(report.scenarios.length, 218);
});

test("scoped historical test executions appear inside the SAME 218 ledger without promoting FULLY_VERIFIED", () => {
  const priorTestEvidence = JSON.parse(readFileSync("docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json", "utf8"));
  const report = buildCurrentReleaseLedger({ source, commitSha: SOURCE_SHA, priorTestEvidence });
  assert.equal(report.scoped_test_progress.previous_distinct_green_cases, 1436);
  // The R18 Company Action Centre browser adds one uncredited source case.
  // Source-case inventory is 1611; old 1436 greens and 218 FULL 0 remain fixed.
  assert.equal(report.scoped_test_progress.existing_static_source_cases, 1611);
  const r18 = priorTestEvidence.cases.find(row =>
    row.case_id === "tests/browser/m3-04-company-action-centre-mixed-status.browser.test.mjs#f30fb16967693ac0");
  assert(r18, "New R18 source-case identity must exist in the original index");
  assert.equal(r18.test_execution, "NO_PASS_LOG_EVIDENCE");
  assert.deepEqual(r18.evidence, []);
  assert.deepEqual(r18.scenario_ids, []);
  assert.equal(report.scoped_test_progress.prior_ci_reference_sha_green_cases, 232);
  assert.equal(report.scoped_test_progress.older_historical_green_cases, 1204);
  assert.equal(report.scoped_test_progress.green_cases_awaiting_exact_scenario_link, 1254);
  assert.equal(report.scoped_test_progress.prior_ci_is_this_exact_sha, false);
  assert.equal(report.counts.full_verified, 0);
  assert.equal(report.release.decision, "NO_GO");
  assert.equal(report.scenarios.length, 218);
  assert(report.scenarios.every(row => row.scoped_test_evidence.full_scenario_certification === "NOT_FULLY_VERIFIED"));
  const reportScenario = report.scenarios.find(row => row.id === "M1.04.02");
  assert(reportScenario.scoped_test_evidence.previously_observed_green_cases > 0);
  assert.equal(reportScenario.status, "NOT_STARTED");
  const tampered = copy(priorTestEvidence);
  tampered.cases[0].test_execution = "EXACT_CI_SHA_PASSED";
  assert.throws(() => buildCurrentReleaseLedger({ source, commitSha: SOURCE_SHA, priorTestEvidence: tampered }), /mismatch/);
});

test("original 218 ledger includes all 216 old scoped observations without promoting release passes", () => {
  const legacy216Evidence = JSON.parse(readFileSync("docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json", "utf8"));
  const priorTestEvidence = JSON.parse(readFileSync("docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json", "utf8"));
  const report = buildCurrentReleaseLedger({
    source, commitSha: SOURCE_SHA, priorTestEvidence, legacy216Evidence
  });
  assert.equal(report.legacy_216_scope.historical_scoped_216_of_218, 216);
  assert.equal(report.legacy_216_scope.old_scoped_references, 316);
  assert.equal(report.legacy_216_scope.old_unambiguously_clean_run_references, 307);
  assert.equal(report.legacy_216_scope.old_mixed_or_uncertain_references, 9);
  assert.deepEqual(report.legacy_216_scope.old_missing_scoped_scenario_ids, ["M1.01.03","M1.01.04"]);
  assert.equal(report.legacy_216_scope.old_source_test_case_candidate_names_distinct_not_automatic_credit, 375);
  assert.equal(report.counts.full_verified, 0);
  assert.equal(report.release.decision, "NO_GO");
  assert(report.scenarios.every(row => row.historical_scoped_216.final_candidate_status === "SCOPED_OLD_ONLY_NOT_FULLY_VERIFIED"));
  const tampered = copy(legacy216Evidence);
  tampered.scenarios[0].old_scoped_evidence[0].legacy_log_sha256 = "fake";
  assert.throws(() => buildCurrentReleaseLedger({source, commitSha: SOURCE_SHA, priorTestEvidence, legacy216Evidence: tampered}),
    /SHA256|hash/i);
});
