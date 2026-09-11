import { spawnSync } from "node:child_process";

const checks = [
  {
    name: "M2.05 randomized assessment form contract",
    command: process.execPath,
    args: ["--test", "tests/platform/randomized-assessment-form-contract.test.mjs"]
  },
  {
    name: "M2.05 database integrity invariants",
    command: process.execPath,
    args: ["--test", "tests/platform/randomized-assessment-form-integrity.test.mjs"]
  },
  {
    name: "M2.05 history preserving rollback and reapply",
    command: process.execPath,
    args: ["--test", "tests/platform/randomized-assessment-form-rollback.test.mjs"]
  },
  {
    name: "M2.05 Question Bank current-version integrity",
    command: process.execPath,
    args: ["--test", "tests/platform/question-current-version-integrity.test.mjs"]
  },
  {
    name: "M2.05 overlapping selector allocation",
    command: process.execPath,
    args: ["scripts/run-assessment-selector-matching-tests.mjs"]
  },
  {
    name: "M2.05 canonical audit action synchronization",
    command: process.execPath,
    args: ["--test", "tests/platform/audit-action-constraint-sync.test.mjs"]
  },
  {
    name: "M2.05 assessment blueprint runtime",
    command: process.execPath,
    args: ["scripts/run-assessment-blueprint-runtime-tests.mjs"]
  },
  {
    name: "M2.05 randomized form generation runtime",
    command: process.execPath,
    args: ["scripts/run-assessment-generation-runtime-tests.mjs"]
  },
  {
    name: "M2.05 answer-safe form delivery runtime",
    command: process.execPath,
    args: ["scripts/run-assessment-form-delivery-tests.mjs"]
  }
];

for (const check of checks) {
  console.log(`\n=== ${check.name} ===`);
  const result = spawnSync(check.command, check.args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    console.error(`${check.name} failed.`);
    process.exit(result.status ?? 1);
  }
}

console.log("M2.05 randomized assessment form verification passed.");
