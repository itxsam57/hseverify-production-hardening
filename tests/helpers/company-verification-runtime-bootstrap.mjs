import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function bootstrapCompanyVerificationRuntimeTest(testFileUrl) {
  if (process.env.HSE_COMPANY_VERIFICATION_RUNTIME_DIST) return;

  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;

  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-company-verification-tests.mjs",
      fileURLToPath(testFileUrl)
    ],
    {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: "inherit"
    }
  );

  process.exit(result.status ?? 1);
}
