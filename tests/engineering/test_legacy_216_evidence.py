#!/usr/bin/env python3
"""Fail-closed checks for the original 216/218 scoped A28 claim and raw logs."""
from pathlib import Path
import importlib.util
import json
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("legacy216",ROOT/"scripts/reconcile-216-historical-scope.py")
legacy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


class LegacyScopedEvidenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=json.loads(legacy.RESULT.read_text())
        cls.by_id={r["id"]:r for r in cls.manifest["scenarios"]}

    def test_exact_216_claim_not_full_acceptance(self):
        outcome=legacy.verify_index()
        self.assertEqual(outcome["old_scoped_scenarios"],216)
        self.assertEqual(outcome["fully_certified_from_old"],0)
        self.assertEqual(len(self.by_id),218)
        self.assertEqual(outcome["missing_old_scoped_scenarios"],["M1.01.03","M1.01.04"])

    def test_all_316_original_log_pointers_captured_with_digest(self):
        n=self.manifest["counts"]
        self.assertEqual(n["total_scoped_observation_references"],316)
        self.assertEqual(n["browser_references"],243)
        self.assertEqual(n["native_references"],57)
        self.assertEqual(n["local_references"],16)
        self.assertEqual(n["unique_old_legacy_log_files_read"],154)
        self.assertEqual(n["scenarios_with_current_test_name_matches_in_old_logs"],193)
        self.assertEqual(n["source_cases_matching_at_least_one_old_historical_clause"],375)
        self.assertEqual(n["scenario_to_source_case_candidate_links_from_old_logs"],1065)
        self.assertEqual(n["unique_old_log_case_titles_unmatched_to_current_source"],55)
        self.assertEqual(len(self.manifest["legacy_old_test_titles_without_current_exact_source_match_for_manual_review"]),55)
        self.assertTrue(all(not x["is_release_pass"] for x in self.manifest["legacy_old_test_titles_without_current_exact_source_match_for_manual_review"]))

    def test_mixed_log_is_not_a_green_pass_even_if_later_success_exists(self):
        n=self.manifest["counts"]
        self.assertEqual(n["old_log_references_with_clean_green_run_summary"],307)
        self.assertEqual(n["old_log_references_mixed_or_missing_clean_run_summary"],9)
        self.assertEqual(n["scenarios_with_at_least_one_old_clean_green_log_reference"],209)
        self.assertTrue(any(ref["log_evidence_status"] == "MIXED_OR_NO_CLEAN_SUMMARY"
                            for ref in self.by_id["M3.11.05"]["old_scoped_evidence"]))
        self.assertTrue(any(
            e["log_evidence_status"]=="MIXED_OR_NO_CLEAN_SUMMARY"
            for e in self.by_id["M2.13.03"]["old_scoped_evidence"]
        ))

    def test_all_previously_unassigned_cases_have_a_nonbinding_review_queue(self):
        import csv
        with (ROOT / 'docs/qa/evidence/MASTERPLAN_218_UNATTRIBUTED_CASE_REVIEW_20261114.csv').open(newline='') as fp:
            rows=list(csv.DictReader(fp))
        self.assertEqual(len(rows),1110)
        self.assertEqual(len({x['case_id'] for x in rows}),1110)
        self.assertEqual(sum(x['previous_execution_evidence']!='NO_PASS_LOG_EVIDENCE' for x in rows),937)
        self.assertEqual(sum(x['previous_execution_evidence']=='NO_PASS_LOG_EVIDENCE' for x in rows),173)
        self.assertEqual(sum(bool(x['suggested_frozen_ids_UNREVIEWED']) for x in rows),1102)
        self.assertTrue(all(x['full_masterplan_verification']=='NOT_FULLY_VERIFIED' for x in rows))

    def test_no_old_reconciliation_claims_exact_release_signoff(self):
        old_sha="eb77b70f6584c76169e7d6b849b88e25ae666696"
        self.assertEqual(self.manifest["historical_a28_source_sha"],old_sha)
        for row in self.manifest["scenarios"]:
            self.assertEqual(row["final_stage_release_verification"],"NOT_FULLY_VERIFIED")
            for ref in row["old_scoped_evidence"]:
                self.assertEqual(len(ref["legacy_log_sha256"]),64)
                self.assertNotEqual(ref["legacy_source_sha"],"f5fe6eb8f5b522c7ed702c9591e8687f906025bb")


if __name__=="__main__":
    unittest.main(verbosity=2)
