import { spawnSync } from "node:child_process";

const contracts = [
  "tests/platform/assessment-attempt-contract.test.mjs",
  "tests/platform/assessment-attempt-rollback.test.mjs",
  "tests/platform/assessment-attempt-ui-contract.test.mjs",
  "tests/platform/assessment-attempt-action-boundary.test.mjs",
  "tests/platform/assessment-attempt-browser-contract.test.mjs",
  "tests/platform/assessment-attempt-audit-contract.test.mjs"
];

const result = spawnSync(process.execPath, ["--test", ...contracts], {
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  console.error("M2.07 candidate assessment window contract failed.");
  process.exit(result.status ?? 1);
}

console.log("M2.07 candidate assessment window contract passed.");
