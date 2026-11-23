import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const exactSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const report = JSON.parse(await readFile(".autopilot/artifacts/current-release-218-ledger.json", "utf8"));
assert.match(exactSha, /^[a-f0-9]{40}$/);
assert.equal(report.exact_sha, exactSha, "Ledger and checked-out code SHA differ");
assert.equal(report.counts?.total, 218, "Frozen Masterplan scenario inventory changed");
const counts = report.counts;
assert.equal(counts.full_verified + counts.in_progress + counts.blocked_external_known +
  counts.failed + counts.not_started, 218, "Scenario status count is inconsistent");
await mkdir("artifacts/independent-audit", { recursive: true });
await writeFile("artifacts/independent-audit/exact-sha-218.json", JSON.stringify(report, null, 2) + "\n");
const summary = {
  exactSha, frozenScenarioCount: 218, fullyVerified: counts.full_verified,
  inProgress: counts.in_progress, blockedExternal: counts.blocked_external_known,
  failed: counts.failed, notStarted: counts.not_started,
  releaseDecision: report.release?.decision || "UNKNOWN",
  source: "npm run audit:current-218-scenarios",
  note: "Only exact-SHA fully certified scenarios count. Past or scoped local passes are not release certification."
};
await writeFile("artifacts/independent-audit/exact-sha-218-summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
