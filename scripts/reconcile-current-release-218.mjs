#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildCurrentReleaseLedger } from "./lib/current-release-218-ledger.mjs";

const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const source = JSON.parse(await readFile(resolve("docs/qa/2026-10-02-evidence.json"), "utf8"));
const priorTestEvidence = JSON.parse(await readFile(resolve("docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json"), "utf8"));
const report = buildCurrentReleaseLedger({ source, commitSha, priorTestEvidence });
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
  artifact
}, null, 2));
