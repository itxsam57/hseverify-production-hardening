#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildCurrentReleaseLedger } from "./lib/current-release-218-ledger.mjs";

const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const source = JSON.parse(await readFile(resolve("docs/qa/2026-10-02-evidence.json"), "utf8"));
const priorTestEvidence = JSON.parse(await readFile(resolve("docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json"), "utf8"));
const legacy216Evidence = JSON.parse(await readFile(
  resolve("docs/qa/evidence/MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json"), "utf8"
));
const coverage4975Evidence = JSON.parse(await readFile(
  resolve("docs/qa/evidence/MASTERPLAN_218_4975_DEDUP_SUMMARY_20261114.json"), "utf8"
));
const report = buildCurrentReleaseLedger({ source, commitSha, priorTestEvidence, legacy216Evidence, coverage4975Evidence });
const artifact = resolve(".autopilot/artifacts/current-release-218-ledger.json");
await mkdir(resolve(".autopilot/artifacts"), { recursive: true });
await writeFile(artifact, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  exact_sha: report.exact_sha,
  frozen_scenarios: report.counts.total,
  frozen_bricks: report.frozen_bricks,
  fully_verified: report.counts.full_verified,
  in_progress: report.counts.in_progress,
  blocked_external_known: report.counts.blocked_external_known,
  not_started: report.counts.not_started,
  release_decision: report.release.decision,
  prior_distinct_green_test_cases: report.scoped_test_progress.previous_distinct_green_cases,
  existing_source_test_cases: report.scoped_test_progress.existing_static_source_cases,
  current_reference_sha_ci_cases: report.scoped_test_progress.prior_ci_reference_sha_green_cases,
  historical_only_green_cases: report.scoped_test_progress.older_historical_green_cases,
  unmapped_green_cases: report.scoped_test_progress.green_cases_awaiting_exact_scenario_link,
  legacy_216_scoped_scenarios: report.legacy_216_scope.historical_scoped_216_of_218,
  legacy_316_old_clause_references: report.legacy_216_scope.old_scoped_references,
  legacy_307_old_clean_log_references: report.legacy_216_scope.old_unambiguously_clean_run_references,
  legacy_9_old_mixed_or_uncertain_references: report.legacy_216_scope.old_mixed_or_uncertain_references,
  legacy_375_unique_name_candidates_not_auto_credited: report.legacy_216_scope.old_source_test_case_candidate_names_distinct_not_automatic_credit,
  planned_check_slots: report.planned_check_progress.planning_slots_total,
  old_partial_dimension_links: report.planned_check_progress.historically_scoped_partial_not_certified,
  uncertain_dimension_links: report.planned_check_progress.uncertain_mixed_or_title_only_not_certified,
  slots_without_precise_old_dimension_link: report.planned_check_progress.without_precise_old_dimension_link,
  fully_certified_planned_checks: report.planned_check_progress.final_stage_certified,
  artifact
}, null, 2));
