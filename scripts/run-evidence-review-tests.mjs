import { spawnSync } from "node:child_process";

for (const args of [
  ["--test", "tests/platform/evidence-review-queue-contract.test.mjs"],
  ["--test", "tests/platform/verifier-review-navigation.test.mjs"],
  ["scripts/run-evidence-review-runtime-tests.mjs"]
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
