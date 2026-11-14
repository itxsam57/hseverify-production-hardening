#!/usr/bin/env python3
"""Tests of real-run deduplication and conservative evidence linking."""
import importlib.util
import json
import subprocess
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

extractor = load("ci_extract", "scripts/collect-prior-qa-ci-tests.py")
prior = load("prior_test_evidence", "scripts/reconcile-218-prior-test-evidence.py")


class PreviousTestEvidenceTests(unittest.TestCase):
    def test_github_job_step_summary_required(self):
        log = "\n".join([
            "job1\tStep 1\t2026-11-14T08:00:00.0000000Z ✔ passing specific case (1.23ms)",
            "job1\tStep 1\t2026-11-14T08:00:00.1000000Z ℹ tests 1",
            "job1\tStep 1\t2026-11-14T08:00:00.2000000Z ℹ pass 1",
            "job1\tStep 1\t2026-11-14T08:00:00.3000000Z ℹ fail 0",
            "job1\tStep 2\t2026-11-14T08:00:00.0000000Z ✔ false-case (1ms)",
            "job1\tStep 2\t2026-11-14T08:00:00.2000000Z ℹ pass 1",
            "job1\tStep 2\t2026-11-14T08:00:00.3000000Z ℹ fail 1",
        ])
        parsed = extractor.parse_ci_log(log)
        self.assertEqual([x["case_name"] for x in parsed["tests"]], ["passing specific case"])
        self.assertEqual(parsed["summary"]["uncertain_groups"], 1)

    def test_historical_duplicate_runs_count_once_and_red_excluded(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            two = []
            for suffix, fail in (("good-a", "ℹ fail 0"), ("good-b", "ℹ fail 0"), ("bad", "ℹ fail 1")):
                p = root / (suffix + ".log")
                p.write_text("✔ same case (1.0ms)\nℹ pass 1\n" + fail + "\n")
                two.append(p)
            index, result = prior.extract_historical({"same case": {"tests/platform/x.test.mjs"}}, two)
            self.assertEqual(len(index), 1)
            self.assertEqual(index[("tests/platform/x.test.mjs", "same case")]["count_repeated_runs"], 2)
            self.assertEqual(result["logs_with_no_clean_pass_summary_or_a_failure"], 1)

    def test_old_execution_index_is_verified_and_not_release_pass(self):
        index = json.loads((ROOT / "docs/qa/evidence/MASTERPLAN_218_EXECUTED_TESTS.json").read_text())
        self.assertEqual(index["frozen_scenarios"], 218)
        c = index["counts"]
        self.assertEqual(c["previous_green_distinct_source_matched_cases"], 1391)
        self.assertEqual(c["current_reference_CI_green_distinct_cases"], 234)
        self.assertEqual(c["historical_only_green_distinct_cases"], 1157)
        self.assertEqual(c["static_existing_distinct_test_cases"], 1565)
        self.assertEqual(c["source_tests_without_green_execution_proof"], 174)
        self.assertEqual(c["frozen_full_release_verified"], 0)
        self.assertEqual(len(index["scenarios"]), 218)
        self.assertEqual(len({x["case_id"] for x in index["cases"]}), 1565)

    def test_existing_case_lookup_is_read_only_and_clearly_uncredited(self):
        result = subprocess.run(["python3", "scripts/reconcile-218-prior-test-evidence.py",
                                 "--lookup-scenario", "M1.01.01"],
                                cwd=ROOT, capture_output=True, text=True, timeout=12)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["original_frozen_scenario"], "M1.01.01")
        self.assertTrue(data["already_linked_prior_tests"])
        self.assertTrue(data["search_candidates_NOT_SCENARIO_CREDIT"])
        self.assertIn("never count automatically", data["disclaimer"])

    def test_original_frozen_scope_has_not_changed(self):
        rows = prior.frozen_rows(ROOT)
        self.assertEqual(len(rows), 218)
        self.assertEqual(len({x["brick"] for x in rows}), 37)


if __name__ == "__main__":
    unittest.main(verbosity=2)
