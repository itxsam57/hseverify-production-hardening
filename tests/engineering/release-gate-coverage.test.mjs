import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("full release gate executes catalogue eligibility and answer recovery regressions", () => {
  const gate = readFileSync("scripts/run-engineering-gate.mjs", "utf8");
  assert.match(gate, /args: \["--test", "tests\/engineering\/assessment-attempt-runner-isolation\.test\.mjs"\]/);
  assert.match(gate, /args: \["scripts\/run-assessment-catalogue-eligibility-tests\.mjs"\]/);
  assert.match(gate, /args: \["scripts\/run-assessment-attempt-tests\.mjs", "--m2-08"\]/);
});

test("full release gate executes financial ledger and concurrent refund regressions", () => {
  const gate = readFileSync("scripts/run-engineering-gate.mjs", "utf8");
  assert.match(gate, /args: \["scripts\/run-billing-tests\.mjs"\]/);
});

test("full release gate executes account recovery atomicity and staff revocation regressions", () => {
  const gate = readFileSync("scripts/run-engineering-gate.mjs", "utf8");
  for (const file of ["account-security-business-rollback", "account-security-notification-runtime", "auth-recovery-otp-runtime", "account-security-audit-runtime", "staff-invitation-revocation-runtime"]) {
    assert.ok(gate.includes(`"tests/platform/${file}.test.mjs"`), `${file} must be selected`);
  }
});

test("full release gate executes scheduling delivery recovery and private data export regressions", () => {
  const gate = readFileSync("scripts/run-engineering-gate.mjs", "utf8");
  for (const file of ["interview-scheduling-email-runtime", "worker-privacy-data-runtime"]) {
    assert.ok(gate.includes(`"tests/platform/${file}.test.mjs"`), `${file} must be selected`);
  }
});

test("full release gate executes registration and privacy audit failure regressions", () => {
  const gate = readFileSync("scripts/run-engineering-gate.mjs", "utf8");
  for (const file of ["notification-bulk-read-runtime", "privacy-sharing-restriction-runtime", "privacy-consent-accommodation-runtime", "privacy-consent-request-runtime", "worker-registration-policy-runtime", "worker-registration-otp-runtime", "company-registration-otp-runtime"]) {
    assert.ok(gate.includes(`"tests/platform/${file}.test.mjs"`), `${file} must be selected`);
  }
});

test("PostgreSQL release gate selects disposable evidence calibration contention proof", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.ok(scripts["test:postgres-json"].includes("tests/platform/evidence-review-calibration-postgres.test.mjs"));
});

test("release gates retain navigation, conditional credential, format pipeline and PostgreSQL restore regressions", () => {
  const gate = readFileSync("scripts/run-engineering-gate.mjs", "utf8");
  for (const file of ["credential-conditional-consumer-runtime", "evidence-file-format-pipeline"]) assert.ok(gate.includes(`"tests/platform/${file}.test.mjs"`));
  const consumer = readFileSync("scripts/run-consumer-cohort-browser-tests.mjs", "utf8");
  for (const file of ["unsaved-form-navigation", "form-history-fallback"]) assert.ok(consumer.includes(`"tests/browser/${file}.browser.test.mjs"`));
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.ok(scripts["test:postgres-json"].includes("tests/platform/report-snapshot-restore-postgres.test.mjs"));
});

test("assessment variants run inside the fail-closed full orchestrator", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.equal(scripts["verify:full"], "node scripts/run-engineering-gate.mjs");
  const gate = readFileSync("scripts/run-engineering-gate.mjs", "utf8");
  assert.ok(gate.includes('args: ["run", "test:assessment-variants-browser"]'));
});
