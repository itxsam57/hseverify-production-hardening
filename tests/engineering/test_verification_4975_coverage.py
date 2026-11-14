#!/usr/bin/env python3
"""Fail-closed regression tests for the provisional 4,975-check coverage ledger."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("verification_4975", ROOT / "scripts/audit-4975-coverage.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class VerificationRegisterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report, cls.rows = audit.build_register(ROOT)

    def test_frozen_scope_unchanged(self):
        self.assertEqual(self.report["frozen_scenarios"], 218)
        self.assertEqual(self.report["frozen_bricks"], 37)
        self.assertEqual(self.report["historical_scenario_labels"], {
            "passed": 36, "partially-verified": 15,
            "not-yet-verified-in-expanded-run": 167,
        })

    def test_inventory_matches_previous_planning_estimate(self):
        self.assertEqual(self.report["entrypoint_types"]["http_method_handlers"], 40)
        self.assertEqual(self.report["entrypoint_types"]["server_action_exports"], 211)
        self.assertEqual(self.report["candidate_entrypoints"], 251)
        self.assertEqual(self.report["responsive_page_files"], 117)
        self.assertEqual(self.report["planned_checks"], 4975)
        self.assertEqual(self.report["planned_check_categories"], {
            "scenario_dimension": 2616, "security_candidate": 2008, "responsive_page": 351,
        })

    def test_every_case_identifier_unique(self):
        self.assertEqual(len(self.rows), len({item["check_id"] for item in self.rows}))
        self.assertEqual(sum(x["category"] == "scenario_dimension" for x in self.rows), 218 * 12)

    def test_no_historical_pass_is_release_certified(self):
        self.assertEqual(self.report["release_certified_checks"], 0)
        self.assertEqual(self.report["release_certified_scenarios"], 0)
        self.assertEqual(self.report["planned_checks_without_full_final_stage_attestation"], 4975)
        self.assertTrue(all(x["release_certification"] == "NOT_CERTIFIED"
                            and not x["exact_sha_staging_attestation"] for x in self.rows))
        row = next(x for x in self.rows if x["check_id"] == "SCENARIO:M1.01.03:01")
        self.assertIn("old_status=passed", row["scoped_historical_hint"])
        self.assertEqual(row["release_certification"], "NOT_CERTIFIED")

    def test_conservative_historical_tsv_summary(self):
        index = self.report["historical_result_index"]
        self.assertEqual(index["evidence_tsv_files"], 26)
        self.assertEqual(index["total_result_rows"], 146)
        self.assertEqual(index["green_result_rows"], 98)
        self.assertEqual(index["sum_reported_passing_cases_NOT_UNIQUE"], 173)
        self.assertEqual(index["green_rows_without_case_count"], 10)
        self.assertEqual(self.report["historical_scenarios_with_a_tsv"], 20)

    def test_committed_register_uses_lf_only(self):
        file = ROOT / "docs/qa/evidence/QA_4975_PROVISIONAL_REGISTER_20261114.csv"
        data = file.read_bytes()
        self.assertEqual(data.count(b"\n"), 4976)
        self.assertNotIn(b"\r", data)

    def test_missing_frozen_scenario_fails_closed(self):
        source = ROOT / "docs/qa/2026-10-02-evidence.json"
        import json
        j = json.loads(source.read_text())
        j["expanded_scenario_verification"]["scenarios"].pop()
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "docs/qa"
            p.mkdir(parents=True)
            (p / source.name).write_text(json.dumps(j))
            with self.assertRaisesRegex(ValueError, "Frozen scenario inventory corrupted"):
                audit.frozen_scenarios(Path(d))


if __name__ == "__main__":
    unittest.main(verbosity=2)
