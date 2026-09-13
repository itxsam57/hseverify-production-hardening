import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--test", "tests/platform/written-scoring-runtime.test.mjs"], { stdio: "inherit" });
process.exit(result.status ?? 1);
