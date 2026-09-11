import { spawnSync } from "node:child_process";

const checks = [
  ["--test", "tests/platform/question-bank-contract.test.mjs"],
  ["--test", "tests/platform/audit-action-constraint-sync.test.mjs"],
  ["scripts/run-question-bank-runtime-tests.mjs"]
];

for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
