import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function readRequired(relativePath) {
  try {
    return await readFile(new URL(relativePath, root), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      assert.fail(`Assessment browser proof is missing required file: ${relativePath}`);
    }
    throw error;
  }
}

function requireAll(source, patterns, label) {
  for (const [pattern, description] of patterns) {
    assert.match(source, pattern, `${label} must ${description}.`);
  }
}

test("M2.07 browser proof drives the real one-question Worker journey and scans for secret leakage", async () => {
  const script = await readRequired("scripts/m2-07-browser-qa.mjs");

  requireAll(
    script,
    [
      [/from\s+["']playwright["']/, "reuse the repository Playwright/Chromium browser stack"],
      [/HSE_BROWSER_BASE_URL/, "run against the real Next.js application"],
      [/seedBrowserScenario/, "provision authoritative assessment prerequisites before the journey"],
      [/loginWorker/, "exercise authenticated Worker sessions"],
      [/\/worker\/available-assessments/, "start from Available assessments"],
      [/Start assessment/, "launch through the visible POST control"],
      [/MULTIPLE_CHOICE/, "exercise a multiple-choice question"],
      [/SHORT_TEXT|LONG_TEXT/, "exercise a written-answer question"],
      [/Submit assessment/, "exercise the final submission control"],
      [/submitted/i, "verify the submitted receipt"],
      [/reload\s*\(/, "refresh an in-progress attempt and verify committed position recovery"],
      [/cross[- ]Worker|other Worker|second Worker/i, "exercise direct attempt access from a different Worker"],
      [/assertFuturePromptAbsent/, "prove future question prompts are absent before server commit"],
      [/assertNoAssessmentSecrets/, "scan delivered HTML and action/network payloads for forbidden assessment secrets"],
      [/answerKey|answer_key/, "include answer-key leakage in the forbidden-secret scan"],
      [/rubric/, "include rubric leakage in the forbidden-secret scan"],
      [/score/, "include score leakage in the forbidden-secret scan"],
      [/correctness|correct/, "include correctness leakage in the forbidden-secret scan"],
      [/internal attempt metadata/i, "classify internal attempt metadata as browser-forbidden"],
      [/workerAccountId/, "scan for internal Worker account identity leakage"],
      [/formId/, "scan for internal generated-form identity leakage"],
      [/startedAt/, "scan for internal attempt lifecycle timestamp leakage"]
    ],
    "M2.07 browser harness"
  );
});

test("M2.07 browser workflow seeds first, runs the real app, and preserves browser evidence", async () => {
  const workflow = await readRequired(".github/workflows/m2-07-browser.yml");

  requireAll(
    workflow,
    [
      [/name:\s*M2\.07 real browser QA/, "have a dedicated M2.07 browser identity"],
      [/feat\/m2-07-assessment-window/, "run on the M2.07 feature branch"],
      [/npm ci --no-audit --no-fund/, "install the locked repository dependencies"],
      [/npm run db:migrate/, "migrate a clean browser database"],
      [/playwright@1\.55\.0/, "reuse the pinned Playwright version already used by repository browser QA"],
      [/playwright install --with-deps chromium/, "install the Chromium runtime"],
      [/node scripts\/m2-07-browser-qa\.mjs --seed-only/, "seed authoritative browser fixtures before the application starts"],
      [/npm run dev -- --hostname 127\.0\.0\.1 --port 3003/, "start the real Next.js development server"],
      [/node scripts\/m2-07-browser-qa\.mjs(?! --seed-only)/, "run the real browser journey after startup"],
      [/artifacts\/m2-07-browser/, "collect M2.07 browser evidence"],
      [/actions\/upload-artifact@v4/, "upload the browser evidence even when the journey fails"]
    ],
    "M2.07 browser workflow"
  );

  const seedIndex = workflow.indexOf("node scripts/m2-07-browser-qa.mjs --seed-only");
  const serverIndex = workflow.indexOf("npm run dev -- --hostname 127.0.0.1 --port 3003");
  const journeyIndex = workflow.lastIndexOf("node scripts/m2-07-browser-qa.mjs");
  assert.ok(seedIndex >= 0 && serverIndex > seedIndex, "M2.07 browser seed must finish before the real application starts.");
  assert.ok(journeyIndex > serverIndex, "M2.07 real browser journey must run after the application starts.");
});

test("M2.08 browser projection carries only the current safe server draft", async () => {
  const domain = await readRequired("src/lib/assessment-attempt/assessment-attempt-domain.ts");
  const projection = await readRequired("src/lib/assessment-attempt/assessment-attempt-client-view.ts");

  requireAll(
    domain,
    [
      [/AssessmentAttemptClientDraft/, "define a bounded client draft type"],
      [/currentDraft\s*:/, "include the current draft on the client view"],
      [/value\s*:\s*string\s*\|\s*boolean\s*\|\s*null/, "limit client draft values to edit-state primitives"],
      [/revision\s*:\s*number/, "expose only the accepted server revision"],
      [/updatedAt\s*:\s*string/, "expose the server acknowledgement timestamp"]
    ],
    "M2.08 client draft domain"
  );

  requireAll(
    projection,
    [
      [/function\s+projectDraft/, "isolate the browser-safe draft projection"],
      [/currentDraft/, "project the current draft explicitly"],
      [/value\s*:/, "project only the draft value"],
      [/revision\s*:/, "project only the draft revision"],
      [/updatedAt\s*:/, "project only the draft timestamp"]
    ],
    "M2.08 client draft projection"
  );

  const draftProjection = projection.match(/function\s+projectDraft[\s\S]*?\n\}/)?.[0] ?? "";
  assert.notEqual(draftProjection, "", "M2.08 client draft projection helper is missing.");
  for (const forbidden of ["mutationKey", "mutationDigest", "formItemId", "formId", "questionId", "questionVersionId", "attemptId", "answerKey", "rubric", "score", "correctness"]) {
    assert.equal(draftProjection.includes(forbidden), false, `M2.08 client draft projection must not expose ${forbidden}.`);
  }
});

test("M2.08 browser proof executes recovery, exit, conflict, progression, storage and leakage journeys in real Chromium", async () => {
  const script = await readRequired("scripts/m2-08-browser-qa.mjs");

  requireAll(
    script,
    [
      [/from\s+["']playwright["']/, "drive real Chromium with Playwright"],
      [/HSE_BROWSER_BASE_URL/, "exercise the real Next.js application"],
      [/seedBrowserScenario/, "seed an isolated authoritative database"],
      [/loginWorker/, "authenticate real Worker sessions"],
      [/getByRole\(\s*["']button["'][\s\S]*Start assessment/, "start through the visible assessment control"],
      [/getByLabel\([\s\S]*\.fill\(/, "create draft edits through real form controls"],
      [/getByText\(\s*["']Saved["']|getByRole\(\s*["']status["'][\s\S]*Saved/, "wait for visible server-acknowledged Saved state"],
      [/\.reload\s*\(/, "reload the real attempt to prove recovery"],
      [/browser\.newContext\s*\(/, "use fresh authenticated browser contexts for server-only recovery"],
      [/localStorage/, "inspect localStorage for forbidden answer persistence"],
      [/indexedDB/, "inspect IndexedDB for forbidden answer persistence"],
      [/serviceWorker/, "inspect service-worker persistence"],
      [/Save and exit/, "exercise Save and exit"],
      [/Resume assessment/, "exercise the owned Resume control"],
      [/Not saved — reconnecting/, "exercise truthful failed-save state"],
      [/Emergency exit/, "exercise bounded Emergency exit"],
      [/\.newPage\s*\(/, "create same-Worker concurrent tabs"],
      [/Use saved version/, "exercise the server-saved conflict choice"],
      [/Replace saved version with this tab/, "exercise explicit CAS replacement"],
      [/Next/, "commit and advance exactly one question"],
      [/Submit assessment/, "exercise final submission"],
      [/cross[- ]Worker|other Worker|second Worker/i, "probe direct access from another Worker"],
      [/assertNoAssessmentSecrets/, "scan rendered and network content for forbidden assessment secrets"],
      [/console/i, "capture browser console failures"],
      [/pageerror/i, "capture uncaught browser errors"],
      [/traffic-summary\.json/, "retain a body-free traffic evidence summary"],
      [/caret:\s*["']initial["']/, "avoid harness-induced caret hydration mutation in screenshots"]
    ],
    "M2.08 browser harness"
  );

  const executedJourneyMarkers = [
    /await\s+page\.getByRole\([\s\S]*Save and exit[\s\S]*\.click\s*\(/,
    /await\s+page\.getByRole\([\s\S]*Emergency exit[\s\S]*\.click\s*\(/,
    /await\s+page\.reload\s*\(/,
    /await\s+page\.evaluate\s*\(/,
    /await\s+.*\.newPage\s*\(/,
    /await\s+page\.getByRole\([\s\S]*Next[\s\S]*\.click\s*\(/,
    /await\s+page\.getByRole\([\s\S]*Submit assessment[\s\S]*\.click\s*\(/
  ];
  for (const marker of executedJourneyMarkers) {
    assert.match(script, marker, "M2.08 browser proof must execute each required journey rather than merely name it.");
  }
});

test("M2.08 browser workflow checks out the exact commit, runs permanent gates and real Chromium, and retains evidence", async () => {
  const workflow = await readRequired(".github/workflows/m2-08-browser.yml");

  requireAll(
    workflow,
    [
      [/name:\s*M2\.08 real browser QA/, "have a dedicated M2.08 browser identity"],
      [/feat\/m2-08-answer-recovery/, "run on the M2.08 feature branch"],
      [/pull_request:[\s\S]*branches:\s*\[main\]/, "run on relevant pull requests to main"],
      [/push:[\s\S]*main/, "remain available on main after merge"],
      [/uses:\s*actions\/checkout@v6[\s\S]*ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/, "check out the exact PR head or push commit"],
      [/npm ci --no-audit --no-fund/, "install locked repository dependencies"],
      [/npm run test:m2-08/, "run the permanent M2.08 targeted suite on the exact head"],
      [/npm run db:migrate/, "migrate a clean isolated browser database"],
      [/playwright@1\.55\.0/, "reuse the repository's pinned Playwright version"],
      [/playwright install --with-deps chromium/, "install Chromium"],
      [/node scripts\/m2-08-browser-qa\.mjs --seed-only/, "seed before application startup"],
      [/npm run dev -- --hostname 127\.0\.0\.1 --port 3004/, "start the real Next.js server on the dedicated browser port"],
      [/node scripts\/m2-08-browser-qa\.mjs(?! --seed-only)/, "execute the browser journey after startup"],
      [/artifacts\/m2-08-browser/, "retain M2.08 screenshots/results/traffic evidence"],
      [/server\.log/, "retain server logs"],
      [/actions\/upload-artifact@v4/, "upload evidence even on failure"],
      [/if:\s*always\(\)/, "collect evidence even when a browser checkpoint fails"]
    ],
    "M2.08 browser workflow"
  );

  const seedIndex = workflow.indexOf("node scripts/m2-08-browser-qa.mjs --seed-only");
  const serverIndex = workflow.indexOf("npm run dev -- --hostname 127.0.0.1 --port 3004");
  const journeyIndex = workflow.lastIndexOf("node scripts/m2-08-browser-qa.mjs");
  assert.ok(seedIndex >= 0 && serverIndex > seedIndex, "M2.08 browser seed must finish before the real application starts.");
  assert.ok(journeyIndex > serverIndex, "M2.08 real browser journey must run after the application starts.");
});
