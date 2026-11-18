import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
TEST=ROOT/"tests/browser/company-workforce-assurance-e2e.browser.test.mjs"
CI=ROOT/".github/workflows/m1-11-03-company-skill-receiving-chromium.yml"

class M11103CompanySkillCI(unittest.TestCase):
    def test_worker_company_verifier_skill_real_browser_and_db_case(self):
        text=TEST.read_text()
        self.assertIn("HSE_M11103_COMPANY_SKILL_ONLY",text)
        self.assertIn("submitSkill(",text)
        for marker in (
            "M11103_COMPANY_SKILL_ACTUAL_CHROME_LINKED_WORKER_COMPANY_RECEIVING",
            "M11103_COMPANY_SKILL_ACTUAL_CHROME_CORRECTION_REVIEW_AND_TWO_PORTAL_HISTORY",
            "M11103_COMPANY_SKILL_ACTUAL_CHROME_RESPONSIVE_320_390_1440",
            "M11103_COMPANY_SKILL_ACTUAL_DB_TWO_VERSIONS_TWO_DECISIONS_ONE_CASE"
        ):
            self.assertIn(marker,text)
        self.assertIn("worker_evidence_versions",text)
        self.assertIn("HSE_M20106_REJECTED_ONLY",text) # original qualification test preserved
    def test_exact_sha_real_chromium_ci_requires_marker_and_fails_closed(self):
        text=CI.read_text()
        self.assertEqual(text.count(".github/workflows/m1-11-03-company-skill-receiving-chromium.yml"),2)
        for phrase in (
            "HSE_M11103_COMPANY_SKILL_ONLY=true",
            "npx playwright install chromium",
            "node --test --test-concurrency=1",
            "github.event.pull_request.head.sha",
            "qa/a28-eligibility-read-guard-20261107",
            "retention-days: 90",
            "LINKED_WORKER_COMPANY_RECEIVING",
            "DB_TWO_VERSIONS_TWO_DECISIONS_ONE_CASE",
            "m11103-company-original-qualification-regression.log",
            "ACTUAL_M20106_CHANGES_APPROVAL_DB"
        ):
            self.assertIn(phrase,text)

if __name__=="__main__":
    unittest.main()
