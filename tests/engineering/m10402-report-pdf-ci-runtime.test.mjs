import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Company report x86 Chromium CI requires real PDF parser before integrity and BOLA browser assertions", () => {
  const workflow = readFileSync(".github/workflows/m1-04-company-report-tenant-bola.yml", "utf8");
  const parserStep = workflow.indexOf("      - name: Ensure real PDF artifact parser is available");
  const browserStep = workflow.indexOf("      - name: Real generated CSV PDF print owner versus independent Company stolen report URLs");
  assert.ok(parserStep > 0 && browserStep > parserStep, "PDF parser setup must run before the real browser PDF assertions");
  const prerequisite = workflow.slice(parserStep, browserStep);
  assert.match(prerequisite, /command -v pdftotext/, "check for actual parser executable");
  assert.match(prerequisite, /apt-get install -y --no-install-recommends poppler-utils/, "install Poppler when missing");
  assert.match(prerequisite, /pdftotext -v/, "verify real parser process launch, not a mock");
  assert.match(workflow.slice(browserStep), /node --test --test-name-pattern=.*Company.*reports/, "retain the original real report browser test");
  assert.match(workflow.slice(browserStep), /pipefail/, "retain nonzero test failure propagation");
});
