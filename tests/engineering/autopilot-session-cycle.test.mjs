import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const command = String.raw`
from pathlib import Path
import sys
sys.path.insert(0, '.autopilot')
import guard

cycle = {'id': 'cycle_A28', 'feature_id': 'A28'}
correct = {'cycle_id': 'cycle_A28', 'feature_id': 'A28'}
guard._require_matching_session_cycle(correct, cycle)
for invalid in [
    {'cycle_id': 'cycle_A25', 'feature_id': 'A28'},
    {'cycle_id': 'cycle_A28', 'feature_id': 'A25'},
    {'cycle_id': None, 'feature_id': 'A28'},
    {'cycle_id': 'cycle_A28'},
]:
    try:
        guard._require_matching_session_cycle(invalid, cycle)
    except ValueError as error:
        assert 'audit session cycle/feature does not match' in str(error)
    else:
        raise AssertionError('mismatched session was allowed: ' + str(invalid))
print('SESSION_CYCLE_MATCH_FAIL_CLOSED')
`;

test("A28 local guard accepts only a session started under the active cycle and feature", () => {
  const result = spawnSync("python3", ["-c", command], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SESSION_CYCLE_MATCH_FAIL_CLOSED/);
});

test("A28 active and closed session paths share the same cycle validator", () => {
  const source = readFileSync(".autopilot/guard.py", "utf8");
  for (const [start, end] of [
    ["def _active_audit_session(", "def _audit_session_for_commit("],
    ["def _audit_session_for_commit(", "def _audit_session_for_push("],
    ["def _audit_session_for_push(", "def check_session("]
  ]) {
    const section = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(section, /_require_matching_session_cycle\(/, `Missing strict check in ${start}`);
  }
});


test("GitHub hosted PDF-checking browser jobs provision the real pdftotext tool", () => {
  const factory = readFileSync(".github/workflows/engineering-factory.yml", "utf8");
  const main = readFileSync(".github/workflows/masterplan-completion-qa.yml", "utf8");
  const jobs = [
    factory.slice(factory.indexOf("  private-browser:")),
    main.slice(main.indexOf("  targeted:"), main.indexOf("  connected-browser:")),
    main.slice(main.indexOf("  connected-browser:"), main.indexOf("  release-readiness:")),
    main.slice(main.indexOf("  consumer-cohorts:"))
  ];
  for (const job of jobs) {
    const tool = job.indexOf("Install PDF text verifier for real credential assertions");
    const testStep = Math.min(...[
      "Install Chromium", "Configure ephemeral test secrets", "Independently invalid production configurations"
    ].map(name => job.indexOf(name)).filter(index => index >= 0));
    assert.ok(tool >= 0 && tool < testStep, "pdftotext is not available before the browser journey");
    assert.match(job, /command -v pdftotext/);
    assert.match(job, /apt-get install -y --no-install-recommends poppler-utils/);
    assert.match(job, /pdftotext -v/);
  }
});
