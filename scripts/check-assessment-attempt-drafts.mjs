import { spawnSync } from "node:child_process";

const contracts = [
  "tests/platform/assessment-attempt-m2-08-gate-contract.test.mjs",
  "tests/platform/assessment-attempt-draft-contract.test.mjs",
  "tests/platform/assessment-attempt-draft-rollback.test.mjs",
  "tests/platform/assessment-attempt-draft-action-boundary.test.mjs",
  "tests/platform/assessment-attempt-draft-ui-contract.test.mjs",
  "tests/platform/assessment-attempt-resume-ui-contract.test.mjs",
  "tests/platform/assessment-attempt-browser-contract.test.mjs",
  "tests/platform/assessment-attempt-ui-contract.test.mjs",
  "tests/platform/assessment-attempt-action-boundary.test.mjs"
];

const result = spawnSync(process.execPath, ["--test", ...contracts], {
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  console.error("M2.08 answer persistence and interruption recovery contract failed.");
  process.exit(result.status ?? 1);
}

console.log("M2.08 answer persistence and interruption recovery contract passed.");
