import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Real staff authoring, Company-funded credential, and trusted-MFA decision journeys execute in CI", () => {
  const workflow = readFileSync(".github/workflows/masterplan-completion-qa.yml", "utf8");
  const connected = workflow.slice(workflow.indexOf("  connected-browser:"), workflow.indexOf("  release-readiness:"));
  const commands = [
    "node --test --test-concurrency=1 tests/browser/m2-05-assessment-generation.browser.test.mjs",
    "node --test --test-concurrency=1 tests/browser/staff-role-complete-journey.browser.test.mjs",
    "node --test --test-concurrency=1 tests/browser/company-finalized-cancellation.browser.test.mjs",
    "node --test --test-concurrency=1 tests/browser/worker-terminal-reapplication.browser.test.mjs",
    "node --test --test-concurrency=1 tests/browser/funding-revoked-link-e2e.browser.test.mjs",
    "node --test --test-concurrency=1 tests/browser/company-credential-target-e2e.browser.test.mjs",
    "node --test --test-concurrency=1 tests/browser/decision-recent-mfa.browser.test.mjs"
  ];
  for (const command of commands) {
    assert.equal(connected.split(command).length - 1, 1, "Missing/duplicate real CI browser command: " + command);
  }
  const wrapper = readFileSync("tests/browser/company-credential-target-e2e.browser.test.mjs", "utf8");
  assert.match(wrapper, /HSE_MASTERPLAN_COMPANY_CREDENTIAL_TARGET/);
  const decision = readFileSync("tests/browser/decision-recent-mfa.browser.test.mjs", "utf8");
  assert.match(decision, /trusted completed MFA timestamp persisted/);
});
