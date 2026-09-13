import { spawnSync } from "node:child_process";

export function ensureAssessmentCatalogueEligibilityRuntime() {
  if (process.env.HSE_ASSESSMENT_CATALOGUE_ELIGIBILITY_RUNTIME_DIST) {
    return process.env.HSE_ASSESSMENT_CATALOGUE_ELIGIBILITY_RUNTIME_DIST;
  }

  const result = spawnSync(
    process.execPath,
    ["scripts/run-assessment-catalogue-eligibility-tests.mjs"],
    {
      env: { ...process.env, HSE_ASSESSMENT_CATALOGUE_ELIGIBILITY_PREPARE_ONLY: "1" },
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    throw new Error(`M2.06 eligibility runtime preparation failed: ${result.stderr}`);
  }

  const runtime = result.stdout.trim();
  if (!runtime) {
    throw new Error("M2.06 eligibility runtime preparation returned no runtime path");
  }

  process.env.HSE_ASSESSMENT_CATALOGUE_ELIGIBILITY_RUNTIME_DIST = runtime;
  return runtime;
}
