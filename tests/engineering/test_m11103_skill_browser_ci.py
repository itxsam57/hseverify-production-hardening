import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BROWSER = ROOT / "tests/browser/independent-worker-review-e2e.browser.test.mjs"
WORKFLOW = ROOT / ".github/workflows/m1-11-03-skill-correction-chromium.yml"

class SkillBrowserCI(unittest.TestCase):
    def test_focused_worker_verifier_browser_security_and_responsive(self):
        text = BROWSER.read_text()
        self.assertIn('HSE_M11103_SKILL_BROWSER_ONLY', text)
        for marker in (
            'M11103_ACTUAL_CHROME_WORKER_VERIFIER_SKILL_V1_CHANGES_V2_APPROVED',
            'M11103_ACTUAL_CHROME_WORKER_ROLE_VERIFIER_ROUTE_DENIED',
            'M11103_ACTUAL_CHROME_RESPONSIVE_320_390_1440',
            'M11103_ACTUAL_CHROME_DB_TWO_SKILL_VERSIONS_TWO_BOUND_REVIEWS'
        ):
            self.assertIn(marker, text)
        self.assertIn('workerContext.request.get(', text)
        self.assertIn('for(const width of [320,390,1440])', text)
        self.assertIn('for(const width of [320,390])', text)
        self.assertIn('worker_evidence_versions', text)

    def test_real_chromium_ci_exact_source_and_self_trigger(self):
        text = WORKFLOW.read_text()
        self.assertEqual(text.count(".github/workflows/m1-11-03-skill-correction-chromium.yml"), 2)
        self.assertIn("qa/a28-eligibility-read-guard-20261107", text)
        self.assertIn("github.event.pull_request.head.sha", text)
        self.assertIn("HSE_M11103_SKILL_BROWSER_ONLY=true", text)
        self.assertIn("npx playwright install chromium", text)
        self.assertIn("node --test --test-concurrency=1", text)
        self.assertIn("retention-days: 90", text)
        self.assertIn("RESPONSIVE_320_390_1440", text)

if __name__ == "__main__":
    unittest.main()
