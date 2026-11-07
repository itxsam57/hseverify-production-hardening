import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tests = [
  "tests/browser/form-history-fallback.browser.test.mjs",
  "tests/browser/unsaved-form-navigation.browser.test.mjs",
  "tests/browser/company-credential-target-e2e.browser.test.mjs",
  "tests/browser/decision-recent-mfa.browser.test.mjs",
  "tests/browser/credential-appeal-operational-e2e.browser.test.mjs",
  "tests/browser/m1-08-company-verification.browser.test.mjs",
  "tests/browser/masterplan-admin-authoring-e2e.browser.test.mjs",
  "tests/browser/case-replay-scoring-assistance-e2e.browser.test.mjs",
  "tests/browser/privacy-consent-accommodation-e2e.browser.test.mjs",
  "tests/browser/privacy-sharing-restriction.browser.test.mjs",
  "tests/browser/all-role-ui-layout.browser.test.mjs",
  "tests/browser/consumer-validation.browser.test.mjs",
  "tests/browser/portal-help.browser.test.mjs",
  "tests/browser/worker-assessment-search.browser.test.mjs",
  "tests/browser/verifier-review-search.browser.test.mjs",
  "tests/browser/admin-verification-search.browser.test.mjs",
  "tests/browser/assessor-interview-search.browser.test.mjs",
  "tests/browser/interview-recommendation-outcomes.browser.test.mjs",
  "tests/browser/root-invitation-search.browser.test.mjs",
  "tests/browser/all-role-notification-workflow.browser.test.mjs",
  "tests/browser/public-navigation.browser.test.mjs",
  "tests/browser/public-inquiry.browser.test.mjs",
  "tests/browser/m3-11-certification.browser.test.mjs",
  "tests/browser/m3-12-production-launch.browser.test.mjs"
];

// In CI, distribute the existing 24 isolated browser fixtures across four
// parallel jobs. Local npm usage with no --shard continues to run all 24.
const args = process.argv.slice(2);
const shardFlag = args.find(argument => argument.startsWith("--shard="));
const otherArgs = args.filter(argument => argument !== shardFlag && argument !== "--list");
if (otherArgs.length || args.filter(argument => argument.startsWith("--shard=")).length > 1) {
  throw new Error("Consumer cohort runner accepts only --shard=1/4 and --list.");
}
const parts = shardFlag ? /^--shard=(\d+)\/(\d+)$/.exec(shardFlag) : null;
if (shardFlag && !parts) throw new Error("Invalid cohort --shard syntax.");
const shard = parts ? Number(parts[1]) : null;
const total = parts ? Number(parts[2]) : null;
if (parts && (!Number.isSafeInteger(shard) || !Number.isSafeInteger(total) ||
  total < 1 || total > tests.length || shard < 1 || shard > total)) {
  throw new Error("Invalid cohort shard index or total.");
}
const selectedTests = parts
  ? tests.filter((_, index) => index % total === shard - 1)
  : tests;
if (args.includes("--list")) {
  console.log(JSON.stringify(selectedTests));
  process.exit(0);
}

// Each existing browser fixture owns its seed and server. Isolate their credentials,
// database and temporary files while retaining actual UI assertions and cleanup.
for (const file of selectedTests) {
  const directory = mkdtempSync(join(tmpdir(), "hse-consumer-browser-"));
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("HSE_") || key === "DATABASE_URL") delete environment[key];
  }
  mkdirSync(join(directory, "tmp"));
  Object.assign(environment, {
    HSE_APP_ENV: "test",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: join(directory, "database"),
    HSE_AUDIT_CREDENTIALS_PATH: join(directory, "credentials.json"),
    HSE_RUNTIME_PROJECT_ROOT: directory,
    HSE_RELEASE_SHA: process.env.HSE_RELEASE_SHA ?? "consumer-browser-test",
    HSE_ENABLE_AUTH_SANDBOX: "false",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    TMPDIR: join(directory, "tmp")
  });
  for (const key of ["HSE_SESSION_SECRET", "HSE_AUTH_PEPPER", "HSE_CREDENTIAL_SIGNING_SECRET"]) {
    environment[key] = randomBytes(32).toString("hex");
  }
  if (file.includes("privacy-consent-accommodation")) environment.HSE_PRIVACY_DATA_DOWNLOAD = "true";
  console.log("\n=== Consumer browser: " + file + " ===");
  let status;
  try {
    const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", file], {
      env: environment, stdio: "inherit"
    });
    if (result.error) console.error(result.error.message);
    status = result.status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (status !== 0) process.exit(status);
}
