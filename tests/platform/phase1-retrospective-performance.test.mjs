import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile("scripts/run-phase1-retrospective-performance.mjs", "utf8");
const browserWorkflow = await readFile(".github/workflows/phase1-retrospective-audit.yml", "utf8");

const requiredPurposeChecks = [
  "Worker registration and authentication concurrency",
  "Tenant-scope concurrency and isolation",
  "M1.05 audit outbox concurrency",
  "M2.02 review claim and terminal-decision races",
  "M2.04 Question Bank stale revision race",
  "M2.05 randomized-form concurrency and non-repetition"
];

test("retrospective performance runner measures every high-risk completed concurrency boundary", () => {
  for (const name of requiredPurposeChecks) {
    assert.match(runner, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(runner, /elapsedMs/);
  assert.match(runner, /performance-concurrency\.json/);
  assert.match(runner, /not a production latency or Internet-scale throughput SLA/i);
});

test("retrospective audit permanently executes the authenticated 50-request mixed-role real-server burst", () => {
  const burstStep = new RegExp(
    "Run 50-request authenticated mixed-role real-server burst[\\s\\S]*?node scripts/hard-browser-mixed-role-burst\\.mjs"
  );
  assert.match(
    browserWorkflow,
    burstStep,
    "retrospective browser gate must execute the permanent mixed-role HTTP burst"
  );
  assert.match(runner, /pendingHttpBurst:\s*false/);
  assert.doesNotMatch(runner, /pendingHttpBurst:\s*true/);
  assert.match(runner, /50-request authenticated mixed-role real-server burst/);
});
