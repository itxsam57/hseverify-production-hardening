import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const outputDirectory = resolve("artifacts", "phase1-retrospective");
const outputPath = resolve(outputDirectory, "performance-concurrency.json");
mkdirSync(outputDirectory, { recursive: true });

const checks = [
  {
    name: "Worker registration and authentication concurrency",
    command: process.execPath,
    args: [
      "--test",
      "tests/platform/worker-registration-concurrency.test.mjs",
      "tests/platform/authentication-portal-isolation.test.mjs"
    ],
    purpose: "Parallel registration/session work must preserve unique account state and strict portal isolation."
  },
  {
    name: "Tenant-scope concurrency and isolation",
    command: "npm",
    args: ["run", "test:tenant-scope"],
    purpose: "Concurrent tenant access must remain scoped to the authenticated Company tenant without cross-tenant leakage."
  },
  {
    name: "M1.05 audit outbox concurrency",
    command: process.execPath,
    args: [
      "--test",
      "tests/platform/audit-concurrency.test.mjs",
      "tests/platform/outbox-concurrency.test.mjs",
      "tests/platform/m1-05-final-concurrency.test.mjs"
    ],
    purpose: "High-value audit/outbox mutations must remain append-only, idempotent and duplicate-safe under concurrent workers."
  },
  {
    name: "M2.02 review claim and terminal-decision races",
    command: process.execPath,
    args: ["scripts/run-evidence-review-tests.mjs"],
    purpose: "Concurrent reviewer claim/decision paths must converge to one legal assignee/terminal decision with no stale-version acceptance."
  },
  {
    name: "M2.04 Question Bank stale revision race",
    command: process.execPath,
    args: ["scripts/run-question-bank-tests.mjs"],
    purpose: "Concurrent question revisions must preserve immutable version history and exactly one current-version winner."
  },
  {
    name: "M2.05 randomized-form concurrency and non-repetition",
    command: process.execPath,
    args: ["scripts/run-assessment-generation-tests.mjs"],
    purpose: "Same-case generation must converge and same-Worker cross-case generation must never persist a repeated stable question."
  }
];

const suiteStartedAt = new Date().toISOString();
const suiteStart = performance.now();
const results = [];
let failed = false;

for (const check of checks) {
  const started = performance.now();
  const processResult = spawnSync(check.command, check.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env
  });
  const elapsedMs = Math.round(performance.now() - started);
  const status = processResult.status === 0 ? "PASS" : "FAIL";
  results.push({
    name: check.name,
    purpose: check.purpose,
    status,
    elapsedMs,
    exitCode: processResult.status
  });
  if (status === "FAIL") failed = true;
}

const evidence = {
  status: failed ? "FAIL" : "PASS",
  interpretation:
    "CI correctness-under-load evidence. Timings are diagnostic only and are not a production latency or Internet-scale throughput SLA.",
  startedAt: suiteStartedAt,
  completedAt: new Date().toISOString(),
  elapsedMs: Math.round(performance.now() - suiteStart),
  checks: results,
  pendingHttpBurst: false,
  httpBurstExecution:
    "The Phase 1 retrospective audit permanently executes a separate 50-request authenticated mixed-role real-server burst for Worker, Company, Verifier, Admin and Root against the real Next.js server boundary."
};

writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Retrospective performance/concurrency evidence written to ${outputPath}`);
if (failed) process.exit(1);
