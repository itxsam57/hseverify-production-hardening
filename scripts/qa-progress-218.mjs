#!/usr/bin/env node
/** One source of truth for the owner-required complete test taskbar. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCurrentReleaseLedger } from "./lib/current-release-218-ledger.mjs";

const json = file => JSON.parse(readFileSync(resolve(file), "utf8"));
const cursor = json("docs/qa/218_VERTICAL_EXECUTION_CURSOR.json");
const source = json("docs/qa/2026-10-02-evidence.json");
const priorTestEvidence = json("docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json");
const legacy216Evidence = json("docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json");
const coverage4975Evidence = json("docs/qa/evidence/MASTERPLAN_218_4975_DEDUP_SUMMARY_20261114.json");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const report = buildCurrentReleaseLedger({
  source, commitSha: sha, priorTestEvidence, legacy216Evidence, coverage4975Evidence
});
assert.equal(cursor.schema_version, 1, "Unknown scenario cursor schema");
assert.equal(cursor.source_of_release_truth, "npm run audit:current-218-scenarios");
assert.equal(cursor.protocol, "docs/qa/218_VERTICAL_EXECUTION_PROTOCOL.md");
assert.equal(cursor.frozen_queue, "docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv");
assert.match(cursor.signed_qa_baseline_sha_before_protocol, /^[a-f0-9]{40}$/);
assert.equal(cursor.no_new_localhost_environment_by_default, true);
assert(typeof cursor.next_exact_command === "string" && cursor.next_exact_command.length > 10);
assert(typeof cursor.next_exact_action === "string" && cursor.next_exact_action.length > 10);
const focus = report.scenarios.find(row => row.id === cursor.current_focus_scenario_id);
assert(focus, "Focus ID must exist in the frozen 218 scenario list");
assert(focus.status !== "FULLY_VERIFIED", "Execution cursor points at already fully verified scenario");
assert.equal(report.counts.total, 218);
assert.equal(report.counts.full_verified + report.counts.in_progress +
  report.counts.blocked_external_known + report.counts.failed + report.counts.not_started, 218);
assert.equal(report.scoped_test_progress.previous_distinct_green_cases +
  report.scoped_test_progress.not_yet_supported_by_previous_green_execution,
report.scoped_test_progress.existing_static_source_cases);
assert.equal(report.planned_check_progress.historically_scoped_partial_not_certified +
  report.planned_check_progress.uncertain_mixed_or_title_only_not_certified +
  report.planned_check_progress.without_precise_old_dimension_link,
  report.planned_check_progress.planning_slots_total);
assert.equal(report.planned_check_progress.final_stage_certified +
  report.planned_check_progress.full_stage_checks_still_required,
  report.planned_check_progress.planning_slots_total);

const nums = report.counts;
const tests = report.scoped_test_progress;
const plan = report.planned_check_progress;
const old = report.legacy_216_scope;
const fmt = number => number.toLocaleString("en-US");
const taskbar = [
  `FULLY VERIFIED ${nums.full_verified}/218 | LEFT ${218 - nums.full_verified} | NOW ${focus.id} ${cursor.current_focus_phase} | RELEASE ${report.release.decision.replaceAll("_", "-")}`,
  `TEST CASES HISTORIC GREEN ${fmt(tests.previous_distinct_green_cases)}/${fmt(tests.existing_static_source_cases)} (NO MATCH ${fmt(tests.not_yet_supported_by_previous_green_execution)}) | OLD SCOPED ${old.historical_scoped_216_of_218}/218 (NOT FULL)`,
  `PLANNED ${fmt(plan.historically_scoped_partial_not_certified)}/${fmt(plan.planning_slots_total)} PARTIAL | ${fmt(plan.uncertain_mixed_or_title_only_not_certified)} UNCERTAIN | ${fmt(plan.without_precise_old_dimension_link)} UNLINKED | FINAL ${fmt(plan.final_stage_certified)}/${fmt(plan.planning_slots_total)}`,
  `PENTEST ${report.release.pentest} (2,008 preliminary attack slots; independently verified UNKNOWN) | BLOCKED ${nums.blocked_external_known} | HIGH/CRITICAL OPEN UNKNOWN | NEXT ${cursor.next_exact_command}`
];
const payload = {
  current_worktree_sha: sha,
  source_of_truth: cursor.source_of_release_truth,
  focus_scenario: focus.id,
  focus_scenario_status: focus.status,
  focus_phase: cursor.current_focus_phase,
  next_exact_action: cursor.next_exact_action,
  next_exact_command: cursor.next_exact_command,
  release: report.release.decision,
  fully_verified: nums.full_verified,
  scenarios_total: 218,
  scenarios_remaining: 218 - nums.full_verified,
  scenarios_in_progress: nums.in_progress,
  blocked_external_known: nums.blocked_external_known,
  scoped_historical_green_source_cases: tests.previous_distinct_green_cases,
  scoped_historical_source_cases_total: tests.existing_static_source_cases,
  source_cases_without_matched_green: tests.not_yet_supported_by_previous_green_execution,
  old_scoped_ids_not_full: old.historical_scoped_216_of_218,
  planned_old_partial_links_not_passed: plan.historically_scoped_partial_not_certified,
  planned_uncertain_links: plan.uncertain_mixed_or_title_only_not_certified,
  planned_without_precise_old_link: plan.without_precise_old_dimension_link,
  planned_check_slots_total: plan.planning_slots_total,
  final_stage_certified_planned_checks: plan.final_stage_certified,
  final_stage_pending_planned_checks: plan.full_stage_checks_still_required,
  pentest: report.release.pentest,
  preliminary_pentest_attack_slots: 2008,
  independent_pentest_completed_verified_count: null,
  unresolved_high_critical_findings_count: null,
  taskbar
};
if (process.argv.includes("--json")) console.log(JSON.stringify(payload, null, 2));
else console.log(taskbar.join("\n"));
