import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/m1-11-03-skill-stale-verifier-pg16.yml"


class SkillCiConfigTests(unittest.TestCase):
    def test_exact_workflow_self_triggers_and_two_real_sql_client_gate(self):
        source = WORKFLOW.read_text()
        self.assertEqual(
            source.count(".github/workflows/m1-11-03-skill-stale-verifier-pg16.yml"),
            2, "Both PR and signed-QA push events must trigger workflow-only edits"
        )
        self.assertNotIn(".github/workflows/m1-11-02-skill-stale-verifier-pg16.yml", source)
        self.assertIn("HSE_M11103_POSTGRES_TEST_DATABASE_URL:", source)
        self.assertIn("M11103_ACTUAL_PG16_", source)
        self.assertIn("M11103_PGLITE_", source)
        self.assertIn("npm ci --no-audit --no-fund", source)
        self.assertIn("postgres:16", source)
        self.assertIn("github.event.pull_request.head.sha", source)
        self.assertIn("retention-days: 90", source)


if __name__ == "__main__":
    unittest.main()
