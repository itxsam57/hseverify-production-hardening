import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = [
  "src/lib/scoring/written-scoring-domain.ts",
  "src/lib/scoring/written-scoring-service.ts",
  "database/migrations/0044_written_scoring_review_engine.up.sql",
  "database/migrations/0048_written_scoring_rubric_marks.up.sql"
];
for (const file of files) {
  if (!existsSync(file)) throw new Error(`M2.10 missing ${file}`);
}
const runtime = spawnSync(process.execPath, ["--test", "tests/platform/written-scoring-production-runtime.test.mjs"], {
  stdio: "inherit"
});
if (runtime.status !== 0) {
  process.exit(runtime.status ?? 1);
}
const security = spawnSync(process.execPath, ["--test", "tests/platform/written-scoring-security-runtime.test.mjs"], {
  stdio: "inherit"
});
if (security.status !== 0) {
  process.exit(security.status ?? 1);
}
console.log("M2.10 written scoring engine contract passed.");
