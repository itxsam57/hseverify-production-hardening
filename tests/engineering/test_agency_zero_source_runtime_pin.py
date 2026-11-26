"""ZERO-001 M1.01.03: approved application source pin must cover deployment helpers.

These tests do not repin the source or certify any scenario.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("agency_zero_pinned_source", ROOT / "scripts/agency_zero_control.py")
CONTROL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROL)


class AgencyZeroRuntimePinContract(unittest.TestCase):
    def test_live_pin_rejects_migration_runtime_edits(self):
        """Actual QA candidate has modified PostgreSQL helpers under scripts/lib."""
        pinned = CONTROL.load_json(CONTROL.CANDIDATE)["source_commit_sha"]
        paths = subprocess.check_output(
            ["git", "diff", "--name-only", pinned, "HEAD", "--",
             "scripts/lib/database.mjs", "scripts/lib/migrations.mjs"],
            cwd=ROOT, text=True,
        )
        self.assertIn("scripts/lib/database.mjs", paths)
        self.assertIn("scripts/lib/migrations.mjs", paths)
        with self.assertRaisesRegex(ValueError, "Pinned application candidate has runtime drift"):
            CONTROL.pinned_candidate_sha()

    def test_preview_runtime_change_also_causes_fail_closed_pin(self):
        """A modified preview smoke runner cannot be approved by omission."""
        original_check_output = CONTROL.subprocess.check_output

        def controlled_diff(command, *args, **kwargs):
            if list(command[:2]) == ["git", "diff"]:
                return "scripts/smoke-preview.mjs\n" if "scripts/smoke-preview.mjs" in command else ""
            return original_check_output(command, *args, **kwargs)

        with patch.object(CONTROL.subprocess, "check_output", side_effect=controlled_diff):
            with self.assertRaisesRegex(ValueError, "scripts/smoke-preview.mjs"):
                CONTROL.pinned_candidate_sha()

    def test_exact_unmodified_candidate_source_is_accepted(self):
        """Matching actual Git head is a controlled test-only comparator, never a persisted repin."""
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        load = CONTROL.load_json

        def exact_test_candidate(path):
            document = load(path)
            if path == CONTROL.CANDIDATE:
                return {**document, "source_commit_sha": head}
            return document

        with patch.object(CONTROL, "load_json", side_effect=exact_test_candidate):
            self.assertEqual(CONTROL.pinned_candidate_sha(), head)


if __name__ == "__main__":
    unittest.main()
