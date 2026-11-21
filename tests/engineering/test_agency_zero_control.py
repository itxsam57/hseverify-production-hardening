"""Fail-closed acceptance tests for the one canonical ZERO 218/58 plan."""
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("agency_zero_control", ROOT / "scripts/agency_zero_control.py")
CONTROL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROL)


class AgencyZeroPlanContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = CONTROL.validate_manifest(CONTROL.load_json(CONTROL.MANIFEST))

    def test_frozen_inventory_and_batch_cardinality(self):
        self.assertEqual(self.plan["original_scenario_count"], 218)
        self.assertEqual(self.plan["original_brick_count"], 37)
        self.assertEqual(self.plan["batch_count"], 58)
        self.assertEqual(len(self.plan["batches"]), 58)
        ids = [unit["scenario_id"] for b in self.plan["batches"] for unit in b["units"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(1 <= len(b["units"]) <= 5 for b in self.plan["batches"]))
        self.assertEqual(self.plan["batches"][0]["batch_id"], "ZERO-001")
        self.assertEqual(self.plan["batches"][-1]["batch_id"], "ZERO-058")

    def test_each_batch_is_one_related_workflow_family(self):
        for batch in self.plan["batches"]:
            self.assertTrue(batch["family"].strip())
            self.assertTrue(re.fullmatch(r"M[123]\.\d{2}", batch["brick"]))
            self.assertTrue(all(unit["scenario_id"].startswith(batch["brick"] + ".")
                                for unit in batch["units"]))

    def test_missing_or_duplicated_case_fails_closed(self):
        broken = copy.deepcopy(self.plan)
        broken["batches"][0]["units"].append(copy.deepcopy(broken["batches"][0]["units"][0]))
        broken["batches"][0]["unit_count"] += 1
        with self.assertRaises(ValueError):
            CONTROL.validate_manifest(broken)

    def test_evidence_parser_requires_schema_and_current_git_sha(self):
        self.assertIsInstance(CONTROL.current_evidence(self.plan), dict)
        self.assertRegex(CONTROL.exact_sha(), r"^[a-f0-9]{40}$")

    def test_37_specialist_charters_have_exact_brick_coverage(self):
        text = (ROOT / "docs/qa/AGENCY_ZERO_REVIEW_MATRIX.md").read_text()
        bricks = re.findall(r"(?m)^\| (M[123]\.\d{2}) \|", text)
        expected = {batch["brick"] for batch in self.plan["batches"]}
        self.assertEqual(len(bricks), 37)
        self.assertEqual(set(bricks), expected)

    def test_forged_independent_signoff_cannot_award_verification(self):
        scenario = self.plan["batches"][0]["units"][0]["scenario_id"]
        sha = CONTROL.exact_sha()
        receipt = {
            "scenario_id": scenario, "source_sha": sha,
            "configuration_fingerprint": "a" * 64,
            "raw_evidence_refs": [{"uri": "private-vault://example", "sha256": "b" * 64}],
            "gates": {"engineering": "PASS", "functional_workflow": "PASS",
                      "ui_accessibility": "PASS", "cybersecurity": "PASS",
                      "independent_review": "PASS", "adapter_contracts": "NOT_APPLICABLE"},
            "adapter_not_applicable_reason": "No external adapter",
            "technical_verdict": "FULLY_VERIFIED",
            "open_high_or_critical": 0, "blocking_defects": [],
            "tested_actions": ["actual UI form submission with receiving actor"],
            "reviewers": {name: {"reviewer_id": "same-actor", "decision": "PASS",
                                  "evidence_sha256": "c" * 64}
                          for name in ("engineering", "cybersecurity", "independent_review")},
        }
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / "receipts.json"
            evidence.write_text(json.dumps({"schema_version": 1,
                                            "technical_attestations": [receipt]}))
            with patch.object(CONTROL, "EVIDENCE", evidence):
                with self.assertRaisesRegex(ValueError, "Independent expert review"):
                    CONTROL.current_evidence(self.plan)

    def test_matrix_only_existing_batches(self):
        selected = CONTROL.find_batch(self.plan, "ZERO-001")
        self.assertEqual(selected["batch_id"], "ZERO-001")
        with self.assertRaises(ValueError):
            CONTROL.find_batch(self.plan, "ZERO-999")


if __name__ == "__main__":
    unittest.main()
