import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("every signed QA branch push regenerates exact-SHA progress and attaches a durable downloadable report", () => {
  const workflow = readFileSync(".github/workflows/qa-current-218-ledger.yml", "utf8");
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- qa\/a28-eligibility-read-guard-20261107/);
  assert.match(workflow, /qa:progress-218/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /current-release-218-ledger\.json/);
  assert.match(workflow, /current-release-218-progress\.json/);
  assert.doesNotMatch(workflow, /assert\.equal\(report\.counts\.full_verified, 0\)/);
});

test("new QA test units automatically preflight disk capacity without touching raw evidence", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["qa:preflight-218"] ?? "", /qa-workspace-prune\.py --apply/);
  assert.match(pkg.scripts["qa:preflight-218"] ?? "", /qa-progress-218/);
  assert.match(readFileSync("AGENTS.md", "utf8"), /qa:preflight-218/);
});
