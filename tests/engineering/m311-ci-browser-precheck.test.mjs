import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// M3.11 calls the real authenticated Playwright burst before any Admin browser
// step. Its isolated drill must never silently become a no-browser simulation.
test("M3.11 hosted certification installs real Chromium before its 50-request drill", () => {
  const source = readFileSync(".github/workflows/masterplan-completion-qa.yml", "utf8");
  const section = source.slice(source.indexOf("  release-readiness:"), source.indexOf("  postgres-json:"));
  const setup = section.indexOf("- name: Install Chromium");
  const certification = section.indexOf("- name: M3.11 execute load security and recovery certification");
  const admin = section.indexOf("- name: M3.11 persisted certification Admin browser");
  assert.ok(setup >= 0 && setup < certification && certification < admin, "Chromium must be installed before 50-request certification");
  assert.match(section, /npx playwright install .* chromium/);
  assert.match(section, /node scripts\/run-m3-11-certification\.mjs/);
});
