import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function ensureWorkerEvidenceRuntime() {
  const existing = process.env.HSE_WORKER_EVIDENCE_RUNTIME_DIST;
  if (existing) return existing;

  const runtime = resolve(".worker-evidence-runtime-test-dist");
  if (!existsSync(`${runtime}/worker-evidence/worker-evidence-attachment-service.js`)) {
    execFileSync("node", ["scripts/run-worker-evidence-record-tests.mjs"], {
      env: {
        ...process.env,
        KEEP_HSE_WORKER_EVIDENCE_RUNTIME_DIST: "1"
      },
      stdio: "ignore"
    });
  }

  process.env.HSE_WORKER_EVIDENCE_RUNTIME_DIST = runtime;
  return runtime;
}
