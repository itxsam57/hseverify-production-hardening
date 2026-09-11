import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredCheckpoints = [
  "Worker registration and contact verification",
  "Worker profile and identity persist across navigation and reload",
  "Worker evidence records preserve history through visible workflow",
  "Company registration and verification workflow",
  "Company sites departments and team workflow",
  "Company Worker invitation and company-code linking workflow",
  "M1.05 notification bell unread deep link workflow",
  "Public verification uses a bounded non-enumerating projection",
  "Public verification Report Concern submits through the real UI",
  "M2.01 Company Assurance Order and Case workflow",
  "M2.02 Verifier opens exact evidence detail and secure preview",
  "M2.02 conflict and terminal decision workflow survives refresh",
  "M2.03 Company effective-policy override workflow",
  "M2.04 Question Bank immutable revision and written rubric workflow",
  "M2.05 Assessment Blueprint create revise status workflow",
  // Responsive acceptance is role-specific: each authenticated portal must retain its own 390x844 overflow proof.
  "Worker mobile layout has no horizontal overflow",
  "Company mobile layout has no horizontal overflow",
  "Verifier mobile layout has no horizontal overflow",
  "Admin mobile layout has no horizontal overflow"
];

async function combinedBrowserSource() {
  const sources = await Promise.all([
    readFile("scripts/hard-browser-qa.mjs", "utf8"),
    readFile("scripts/hard-browser-retrospective.mjs", "utf8"),
    readFile("scripts/hard-browser-retrospective-worker-evidence.mjs", "utf8"),
    readFile("scripts/hard-browser-retrospective-company-registration.mjs", "utf8"),
    readFile("scripts/hard-browser-public-concern.mjs", "utf8"),
    readFile("scripts/m2-05-browser-qa.mjs", "utf8")
  ]);
  return sources.join("\n");
}

test("retrospective hard-browser QA names every completed user-facing workflow it must execute", async () => {
  const source = await combinedBrowserSource();
  for (const checkpoint of requiredCheckpoints) {
    assert.match(
      source,
      new RegExp(checkpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `missing real-browser checkpoint: ${checkpoint}`
    );
  }
});

test("retrospective browser workflow remains a real Chromium journey with retained evidence", async () => {
  const source = await combinedBrowserSource();
  assert.match(source, /chromium\.launch\(/);
  assert.match(source, /page\.on\("pageerror"/);
  assert.match(source, /message\.type\(\) === "error"/);
  assert.match(source, /page\.reload\(/);
  assert.match(source, /page\.screenshot\(/);
  assert.match(source, /results\.json/);
});

test("M1.05 notification browser checkpoint executes exactly once", async () => {
  const source = await readFile("scripts/hard-browser-qa.mjs", "utf8");
  const matches = source.match(
    /checkpoint\("M1\.05 notification bell unread deep link workflow"/g
  ) ?? [];
  assert.equal(
    matches.length,
    1,
    `M1.05 notification browser checkpoint must execute once, found ${matches.length}`
  );
});

test("Worker responsive retrospective checkpoint executes exactly once", async () => {
  const source = await readFile("scripts/hard-browser-retrospective.mjs", "utf8");
  const matches = source.match(
    /checkpoint\("Worker mobile layout has no horizontal overflow"/g
  ) ?? [];
  assert.equal(
    matches.length,
    1,
    `Worker mobile retrospective checkpoint must execute once, found ${matches.length}`
  );
});
