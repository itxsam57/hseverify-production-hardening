import { spawnSync } from "node:child_process";

export function ensureCompanyWorkforceRuntime() {
  if (process.env.HSE_COMPANY_WORKFORCE_RUNTIME_DIST) return;

  const result = spawnSync(
    process.execPath,
    ["scripts/run-company-worker-invitation-tests.mjs"],
    { stdio: "inherit", env: process.env }
  );

  process.exit(result.status ?? 1);
}
