#!/usr/bin/env python3
"""Tests of real-run deduplication and conservative evidence linking."""
import importlib.util
import json
import hashlib
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
        self.assertEqual(c["previous_green_distinct_source_matched_cases"], 1436)
        self.assertEqual(c["current_reference_CI_green_distinct_cases"], 232)
        self.assertEqual(c["historical_only_green_distinct_cases"], 1204)
        self.assertEqual(c["static_existing_distinct_test_cases"], 1611)
        self.assertEqual(c["source_tests_without_green_execution_proof"], 175)
        self.assertEqual(c["frozen_full_release_verified"], 0)
        self.assertEqual(len(index["scenarios"]), 218)
        self.assertEqual(len({x["case_id"] for x in index["cases"]}), 1611)
        # Newly added R18 source test is inventory only, never a historical green.
        r18 = next(x for x in index["cases"] if x["case_id"] ==
                   "tests/browser/m3-04-company-action-centre-mixed-status.browser.test.mjs#f30fb16967693ac0")
        self.assertEqual(r18["test_execution"], "NO_PASS_LOG_EVIDENCE")
        self.assertEqual(r18["evidence"], [])
        self.assertEqual(r18["scenario_ids"], [])

    def test_archived_old_green_provenance_survives_local_cache_removal_without_new_pass(self):
        prior_reviewed = {
            "case_id": "tests/platform/x.test.mjs#" + hashlib.sha256(b"specific old true completed test").hexdigest()[:16], "file": "tests/platform/x.test.mjs",
            "title": "specific old true completed test",
            "test_execution": "HISTORICAL_LOG_PASSED",
            "prior_log_pass_repetition_count": 3, "exact_ci_pass_count_runs": 0,
            "evidence": [{"source_log": "older/.autopilot/artifacts/proof.log",
                          "sha256": "a" * 64,
                          "status": "clean_green_summary_historical_worktree",
                          "tested_commit_sha": "UNKNOWN_FROM_LOG_NOT_RELEASE_ATTESTATION"}]
        }
        preserved = prior.reviewed_proof_if_archived(prior_reviewed,
                                                     prior_reviewed["file"],
                                                     prior_reviewed["title"])
        self.assertEqual(preserved["test_execution"], "HISTORICAL_LOG_PASSED")
        self.assertEqual(preserved["prior_log_pass_repetition_count"], 3)
        self.assertIsNone(prior.reviewed_proof_if_archived(prior_reviewed,
                                                          "tests/platform/renamed.test.mjs",
                                                          prior_reviewed["title"]))
        tampered = {**prior_reviewed, "evidence": [{"sha256": "fake"}]}
        self.assertIsNone(prior.reviewed_proof_if_archived(tampered,
                                                          prior_reviewed["file"],
                                                          prior_reviewed["title"]))
        no_green = {**prior_reviewed, "test_execution": "NO_PASS_LOG_EVIDENCE"}
        self.assertIsNone(prior.reviewed_proof_if_archived(no_green,
                                                          no_green["file"], no_green["title"]))

    def test_old_proof_hashes_are_never_replaced_by_new_historical_log(self):
        old = {"sha256": "a" * 64, "source_log": "old/.autopilot/artifacts/original.log",
               "status": "clean_green_summary_historical_worktree"}
        new = {"sha256": "b" * 64, "source_log": "new/.autopilot/artifacts/new.log",
               "status": "clean_green_summary_historical_worktree"}
        ci = {"run_log_sha256": "c" * 64, "tested_commit_sha": "d" * 40,
              "status": "exact_CI_SHA_green_test_and_run"}
        result = prior.merge_stable_provenance([old, ci], [old, new, ci])
        self.assertEqual(result, [old, ci, new])

    def test_remote_archival_cannot_erase_previously_source_reviewed_green_or_create_skill_pass(self):
        """A missing ignored old log must not downgrade the durable signed QA receipt.

        This simulates all historical worktree raw logs being safely archived,
        while preserving only previously hash-backed source case identities.
        """
        offline_ci = {"runs": [], "source_sha": "f" * 40,
                      "github_workflows_successful": 0, "github_workflows_log_read": 0}
        previous = prior.build(ROOT, offline_ci, scan_historical=False)
        counts = previous["counts"]
        self.assertEqual(counts["previous_green_distinct_source_matched_cases"], 1436)
        self.assertEqual(counts["static_existing_distinct_test_cases"], 1611)
        self.assertEqual(counts["frozen_full_release_verified"], 0)
        old = next(c for c in previous["cases"] if c["title"].startswith(
            "independent Worker submissions reach Verifier and approve"))
        self.assertEqual(old["test_execution"], "HISTORICAL_LOG_PASSED")
        self.assertIn("M1.11.03", old["scenario_ids"])
        skill = next(c for c in previous["cases"] if c["title"].startswith(
            "M1.11.03 skill correction retains old review"))
        self.assertEqual(skill["test_execution"], "HISTORICAL_LOG_PASSED")
        self.assertTrue(any(proof.get("status") == "clean_green_summary_historical_worktree" for proof in skill["evidence"]))

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
