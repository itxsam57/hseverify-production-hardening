import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  FROZEN_MASTERPLAN_DIGEST,
  buildCurrentReleaseLedger
} from "../../scripts/lib/current-release-218-ledger.mjs";

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
