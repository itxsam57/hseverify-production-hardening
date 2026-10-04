import { spawnSync } from "node:child_process";

// This named scenario uses the combined strict form and self-funded reassessment.
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (key.startsWith("HSE_MASTERPLAN_")) delete environment[key];
}
Object.assign(environment, {
  HSE_MASTERPLAN_COMPLETE_REASSESSMENT: "true",
  HSE_MASTERPLAN_CONTENT_MODE: "COMBINED",
  HSE_MASTERPLAN_DELIVERY_MODE: "STRICT"
});
const result = spawnSync(process.execPath, [
  "--test", "tests/browser/masterplan-worker-credential-e2e.browser.test.mjs"
], { stdio: "inherit", env: environment });
process.exit(result.status ?? 1);
