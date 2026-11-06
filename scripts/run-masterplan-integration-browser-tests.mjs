import { spawnSync } from "node:child_process";

const tests = [
  "tests/browser/integrity-human-review.browser.test.mjs",
  "tests/browser/supervisor-observation-journey.browser.test.mjs",
  "tests/browser/evidence-review-calibration.browser.test.mjs",
  "tests/browser/written-review-assignment.browser.test.mjs",
  "tests/browser/written-scoring-recovery.browser.test.mjs",
  "tests/browser/evidence-review-quality.browser.test.mjs",
  "tests/browser/duplicate-identity-review.browser.test.mjs",
  "tests/browser/credential-appeal-interview.browser.test.mjs",
  "tests/browser/credential-appeal-evidence.browser.test.mjs"
];

for (const file of tests) {
  console.log("\n=== Masterplan integration browser: " + file + " ===");
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", file], {
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
