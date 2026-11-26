"""Original ZERO-001 M1.01.03: bounded QA-only contract checks."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
WORKFLOW=ROOT/".github/workflows/independent-full-system-audit.yml"
BROWSER=ROOT/"tests/browser/credential-validity.browser.test.mjs"

class CIIsolationContract(unittest.TestCase):
    def test_synthetic_audit_server_stops_after_its_browser_audit_and_before_regression(self):
        text=WORKFLOW.read_text()
        self.assertLess(text.index("Upload pre-crosscheck independent audit evidence"),text.index("Stop only the synthetic audit server before complete regression"))
        self.assertLess(text.index("Stop only the synthetic audit server before complete regression"),text.index("Existing full regression gate cross-check after independent audit"))
        self.assertIn('process_command=$(ps -p "$audit_pid" -o args= || true)',text)
        self.assertIn('!= *"scripts/run-development.mjs"*',text)
        self.assertIn('kill -TERM -- "-$audit_pid"',text)
        self.assertIn('::error::Synthetic audit server did not stop',text)

    def test_regression_fails_closed_if_previous_server_is_alive_and_final_cleanup_retained(self):
        text=WORKFLOW.read_text()
        self.assertIn("Full regression cannot start while synthetic audit server PID",text)
        self.assertIn("fail_closed_regression",text)
        self.assertIn("existing_full_regression_crosscheck 1 >> artifacts/independent-audit/commands.tsv",text)
        self.assertIn("Invalid audit-server PID prevents safe full-regression isolation.",text)
        self.assertIn("timeout -k 10s 5400s npm run verify:full",text)
        self.assertIn("Stop only this audit's server process group",text)
        self.assertEqual(text.count("name: Existing full regression gate cross-check after independent audit"),1)

    def test_original_credential_browser_assertion_is_frozen_and_strong(self):
        import subprocess
        import json
        pin=json.loads((ROOT/"docs/qa/AGENCY_ZERO_CANDIDATE.json").read_text())["source_commit_sha"]
        approved=subprocess.check_output(
            ["git","show",pin+":tests/browser/credential-validity.browser.test.mjs"],cwd=ROOT
        )
        actual=BROWSER.read_bytes()
        self.assertEqual(actual,approved,"Historic case source changed; preserve evidence instead of modifying the test")
        source=actual.decode()
        self.assertEqual(source.count('getByRole("columnheader",{name:"Assurance"}).waitFor({timeout:15000})'),1)
        self.assertNotIn("M21304_COMPANY_WORKFORCE_FAILURE_DIAGNOSTIC",source)

if __name__=="__main__":
    unittest.main()
