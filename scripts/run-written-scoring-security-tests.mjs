import { spawnSync } from "node:child_process";

const tests = [
  "tests/platform/written-scoring-security-runtime.test.mjs",
  "tests/platform/written-scoring-security-persistence-runtime.test.mjs",
  "tests/platform/written-scoring-security-isolation-runtime.test.mjs",
  "tests/platform/written-scoring-security-production-runtime.test.mjs",
  "tests/platform/written-scoring-security-live-runtime.test.mjs"
];

for (const testFile of tests) {
  const result = spawnSync(process.execPath, ["--test", testFile], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
