import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

import { chromium } from "playwright";

import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3004";
const PASSWORD = "M207Browser!StrongPassword2026";
const WORKER_A = Object.freeze({ email: "worker-a.m207.browser@example.test" });
const WORKER_B = Object.freeze({ email: "worker-b.m207.browser@example.test" });
const ASSESSMENT_TITLE = "M2.08 Browser Assessment";
const DECIMAL_PROMPT = "Enter the controlled M2.08 decimal draft exactly as instructed.";
const WRITTEN_PROMPT = "Briefly describe the next safe action for the M2.07 browser hazard scenario.";
const WRITTEN_RUBRIC_SECRET = "M207-RUBRIC-SECRET-SHOULD-NEVER-LEAK";
const INITIAL_DRAFT = " 12.";
const SAVE_EXIT_DRAFT = " 13.";
const FAILED_EXIT_DRAFT = " 14.";
const EMERGENCY_UNCONFIRMED_DRAFT = " 15.";
const CONFLICT_WINNER_DRAFT = " 16.";
const CONFLICT_LOSER_DRAFT = " 17.";
const RESOLVED_SECONDARY_DRAFT = " 18.";
const REPLACEMENT_DRAFT = " 19.";
const DELAYED_OLD_DRAFT = " 20.";
const FINAL_ANSWER = "Stop the activity, control the hazard, and verify the area is safe before resuming.";
const NOW = "2026-09-01T16:00:00.000Z";
const artifactsDir = "artifacts/m2-08-browser";
const results = [];
const traffic = [];
const unexpectedBrowserErrors = [];
let allowExpectedNetworkFailures = false;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function consumeExpectedBrowserError(expected) {
  const index = unexpectedBrowserErrors.indexOf(expected);
  if (index >= 0) unexpectedBrowserErrors.splice(index, 1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkpoint(name, operation) {
  const started = Date.now();
  try {
    const detail = await operation();
    results.push({ name, status: "PASS", ms: Date.now() - started, detail: detail ?? null });
    console.log(`PASS ${name}`);
    return detail;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, status: "FAIL", ms: Date.now() - started, error: message });
    console.error(`FAIL ${name}: ${message}`);
    throw error;
  }
}

export async function seedBrowserScenario() {
  const seeded = spawnSync(process.execPath, ["scripts/m2-07-browser-qa.mjs", "--seed-only"], {
    stdio: "inherit",
    env: process.env
  });
  if (seeded.status !== 0) {
    throw new Error(`M2.08 browser seed could not create the authoritative M2.07 base fixture (exit ${seeded.status ?? "unknown"}).`);
  }

  const environment = readProjectEnvironment();
  assert(environment.databaseDriver === "pglite", "M2.08 browser seed requires the isolated PGlite test database.");
  assert(environment.pgliteDataDir && environment.pgliteDataDir !== "memory://", "M2.08 browser seed requires a persisted PGlite directory shared with Next.js.");

  const database = await openScriptDatabase(environment);
  try {
    const frameworkResult = await database.query(
      `SELECT framework_id,created_by_account_id
       FROM assurance_frameworks
       WHERE framework_reference='M207-BROWSER'
       LIMIT 1`
    );
    const frameworkId = frameworkResult.rows[0]?.framework_id;
    const createdByAccountId = frameworkResult.rows[0]?.created_by_account_id;
    assert(typeof frameworkId === "string", "M2.08 browser seed could not resolve the base framework.");
    assert(typeof createdByAccountId === "string", "M2.08 browser seed could not resolve the fixture owner.");

    const blueprintResult = await database.query(
      `SELECT blueprint_id
       FROM assessment_blueprints
       WHERE blueprint_reference='BP-M207-BROWSER'
       LIMIT 1`
    );
    const blueprintId = blueprintResult.rows[0]?.blueprint_id;
    assert(typeof blueprintId === "string", "M2.08 browser seed could not resolve the base blueprint.");

    const catalogueResult = await database.query(
      `SELECT catalogue_entry_id
       FROM assessment_catalogue_entries
       WHERE catalogue_reference='CAT-M207-BROWSER'
       LIMIT 1`
    );
    const catalogueEntryId = catalogueResult.rows[0]?.catalogue_entry_id;
    assert(typeof catalogueEntryId === "string", "M2.08 browser seed could not resolve the base catalogue entry.");

    const decimalQuestionId = `assessment_question_${digest("m208-browser-decimal-question").slice(0, 24)}`;
    const decimalQuestionVersionId = `question_version_${digest("m208-browser-decimal-version").slice(0, 24)}`;
    const blueprintVersionId = `blueprint_version_${digest("m208-browser-blueprint-v2").slice(0, 24)}`;
    const catalogueVersionId = `catalogue_version_${digest("m208-browser-catalogue-v2").slice(0, 24)}`;
    const fingerprint = digest(`DECIMAL:${DECIMAL_PROMPT}:m208-browser`);

    await database.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO assessment_questions(
           question_id,question_reference,question_status,current_version_id,current_content_fingerprint,
           created_by_account_id,created_at,updated_at
         ) VALUES($1,'M208-Q-DECIMAL','INACTIVE',NULL,NULL,$2,$3,$3)`,
        [decimalQuestionId, createdByAccountId, NOW]
      );
      await tx.query(
        `INSERT INTO assessment_question_versions(
           question_version_id,question_id,version_no,question_type,prompt,options_json,
           answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
           content_fingerprint,created_by_account_id,created_at
         ) VALUES($1,$2,1,'DECIMAL',$3,NULL,$4::jsonb,NULL,$5,'Draft Recovery','MEDIUM','[]'::jsonb,$6,$7,$8)`,
        [
          decimalQuestionVersionId,
          decimalQuestionId,
          DECIMAL_PROMPT,
          JSON.stringify(19),
          frameworkId,
          fingerprint,
          createdByAccountId,
          NOW
        ]
      );
      await tx.query(
        `UPDATE assessment_questions
         SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE',updated_at=$4
         WHERE question_id=$1`,
        [decimalQuestionId, decimalQuestionVersionId, fingerprint, NOW]
      );

      await tx.query(
        `INSERT INTO assessment_blueprint_versions(
           blueprint_version_id,blueprint_id,version_no,framework_id,title,
           selectors_json,created_by_account_id,created_at
         ) VALUES($1,$2,2,$3,'M2.08 Browser Blueprint',$4::jsonb,$5,$6)`,
        [
          blueprintVersionId,
          blueprintId,
          frameworkId,
          JSON.stringify([
            { count: 1, questionType: "DECIMAL", tagsAll: [] },
            { count: 1, questionType: "SHORT_TEXT", tagsAll: [] }
          ]),
          createdByAccountId,
          NOW
        ]
      );
      await tx.query(
        `UPDATE assessment_blueprints
         SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3
         WHERE blueprint_id=$1`,
        [blueprintId, blueprintVersionId, NOW]
      );

      await tx.query(
        `INSERT INTO assessment_catalogue_versions(
           catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,
           blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at
         ) VALUES($1,$2,2,$3,'Real M2.08 server-draft recovery and interruption browser proof',$4,$5,0,$6,$7)`,
        [
          catalogueVersionId,
          catalogueEntryId,
          ASSESSMENT_TITLE,
          frameworkId,
          blueprintVersionId,
          createdByAccountId,
          NOW
        ]
      );
      await tx.query(
        `UPDATE assessment_catalogue_entries
         SET current_version_id=$2,catalogue_status='ACTIVE',updated_at=$3
         WHERE catalogue_entry_id=$1`,
        [catalogueEntryId, catalogueVersionId, NOW]
      );
    });

    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      `${artifactsDir}/seed.json`,
      JSON.stringify(
        {
          frameworkId,
          decimalQuestionVersionId,
          blueprintVersionId,
          catalogueVersionId,
          assessmentTitle: ASSESSMENT_TITLE,
          workerA: WORKER_A.email,
          workerB: WORKER_B.email,
          questionOrder: ["DECIMAL", "SHORT_TEXT"]
        },
        null,
        2
      )
    );
    console.log(`Seeded M2.08 browser scenario for framework ${frameworkId}.`);
  } finally {
    await database.close();
  }
}

async function goto(page, path) {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  assert(response, `${path} returned no response.`);
  return response;
}

function attachPageEvidence(page, label) {
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() !== "error") return;
    if (allowExpectedNetworkFailures && /failed to fetch|err_failed|networkerror/i.test(text)) return;
    unexpectedBrowserErrors.push(`${label} console: ${text}`);
  });
  page.on("pageerror", (error) => {
    if (allowExpectedNetworkFailures && /failed to fetch|networkerror/i.test(error.message)) return;
    unexpectedBrowserErrors.push(`${label} pageerror: ${error.message}`);
  });
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.origin !== BASE_URL) return;
      const body = request.postData();
      if (request.method() === "POST" && body) {
        traffic.push({ kind: "request", label, url: request.url(), method: request.method(), body });
      }
    } catch {
      // Ignore unrelated malformed requests; retained evidence is application-only.
    }
  });
  page.on("response", async (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin !== BASE_URL) return;
      const contentType = response.headers()["content-type"] ?? "";
      if (!/(?:text\/html|text\/x-component|application\/json)/i.test(contentType)) return;
      const body = await response.text();
      traffic.push({
        kind: "response",
        label,
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        contentType,
        body
      });
    } catch {
      // Navigation can cancel body reads; do not fabricate evidence for a missing body.
    }
  });
}

async function loginWorker(browser, credentials, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  attachPageEvidence(page, label);
  const response = await goto(page, "/worker/login");
  assert(response.status() === 200, `${label} Worker login returned HTTP ${response.status()}.`);
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(
    (url) => url.origin === BASE_URL && url.pathname.startsWith("/worker/") && !url.pathname.includes("/login"),
    { timeout: 20_000 }
  );
  return { context, page };
}

async function waitForSaved(page) {
  await page.getByRole("status").filter({ hasText: /^Saved$/ }).waitFor({ state: "visible", timeout: 20_000 });
}

async function currentAnswerInput(page) {
  const input = page.getByLabel("Your answer");
  await input.waitFor({ state: "visible", timeout: 20_000 });
  return input;
}

async function assertNoBrowserPersistence(page, sentinel) {
  const snapshot = await page.evaluate(async (draftSentinel) => {
    const localEntries = Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]);
    const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    const serviceWorkerRegistrations = "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : [];
    const serviceWorkerScopes = serviceWorkerRegistrations.map((registration) => registration.scope);
    const cacheNames = await caches.keys();
    const cacheBodies = [];
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) continue;
        try {
          cacheBodies.push(await response.clone().text());
        } catch {
          // Binary/unreadable cache entries cannot contain our controlled UTF-8 sentinel evidence.
        }
      }
    }
    return { localEntries, databases, serviceWorkerScopes, cacheNames, cacheBodies, draftSentinel };
  }, sentinel);

  const localText = JSON.stringify(snapshot.localEntries);
  const indexedText = JSON.stringify(snapshot.databases);
  const serviceWorkerText = JSON.stringify(snapshot.serviceWorkerScopes);
  const cacheText = JSON.stringify(snapshot.cacheBodies);
  assert(!localText.includes(sentinel), "Draft answer leaked into localStorage.");
  assert(!indexedText.includes(sentinel), "Draft answer marker leaked into IndexedDB metadata.");
  assert(!serviceWorkerText.includes(sentinel), "Draft answer marker leaked into service-worker registration metadata.");
  assert(!cacheText.includes(sentinel), "Draft answer leaked into service-worker/browser caches.");
  return {
    localStorageEntries: snapshot.localEntries.length,
    indexedDbDatabases: snapshot.databases.length,
    serviceWorkerRegistrations: snapshot.serviceWorkerScopes.length,
    cacheNames: snapshot.cacheNames.length
  };
}

function assertNoAssessmentSecrets(records, { requireFuturePromptAbsent = false } = {}) {
  const forbidden = [
    { pattern: /["']?answerKey["']?\s*[:=]|answer_key/i, label: "answer key" },
    { pattern: /["']?rubric["']?\s*[:=]/i, label: "rubric" },
    { pattern: /["']?score["']?\s*[:=]/i, label: "score" },
    { pattern: /["']?correct(?:ness)?["']?\s*[:=]/i, label: "correctness" },
    { pattern: /["']?pass(?:ed|Fail)?["']?\s*[:=]/i, label: "pass/fail result" },
    { pattern: /["']?reviewer[A-Za-z]*["']?\s*[:=]/i, label: "reviewer data" },
    { pattern: new RegExp(WRITTEN_RUBRIC_SECRET, "i"), label: "rubric sentinel" }
  ];
  for (const record of records) {
    for (const item of forbidden) {
      assert(!item.pattern.test(record.body), `Forbidden ${item.label} leaked through ${record.kind} ${record.url}.`);
    }
    if (requireFuturePromptAbsent) {
      assert(!record.body.includes(WRITTEN_PROMPT), `Future question prompt leaked before progression through ${record.kind} ${record.url}.`);
    }
  }
}

async function screenshot(page, name) {
  await page.screenshot({
    path: `${artifactsDir}/${name}.png`,
    fullPage: true,
    caret: "initial"
  });
}

function trafficSummary() {
  return traffic.map((record) => ({
    kind: record.kind,
    label: record.label,
    url: record.url,
    method: record.method,
    ...(record.status ? { status: record.status } : {}),
    ...(record.contentType ? { contentType: record.contentType } : {}),
    bodyLength: record.body.length
  }));
}

async function runBrowserJourney() {
  await mkdir(artifactsDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const state = {
    primary: null,
    secondary: null,
    otherWorker: null,
    attemptId: null,
    preAdvanceTrafficEnd: 0
  };

  const scenarios = [
    {
      name: "save acknowledged draft",
      run: async () => {
        state.primary = await loginWorker(browser, WORKER_A, "worker-a-primary");
        const { page } = state.primary;
        const response = await goto(page, "/worker/available-assessments");
        assert(response.status() === 200, `Available assessments returned HTTP ${response.status()}.`);
        await page.getByRole("heading", { name: ASSESSMENT_TITLE }).waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: "Start assessment" }).click();
        await page.waitForURL(/\/worker\/assessments\/assessment_attempt_[A-Za-z0-9_-]{24}$/, { timeout: 20_000 });
        state.attemptId = page.url().split("/").pop();
        assert(state.attemptId && /^assessment_attempt_[A-Za-z0-9_-]{24}$/.test(state.attemptId), "Visible Start assessment did not create a valid attempt reference.");
        await page.getByText("Question 1 of 2", { exact: true }).waitFor({ timeout: 20_000 });
        await page.getByText(DECIMAL_PROMPT, { exact: true }).waitFor({ timeout: 20_000 });
        const input = await currentAnswerInput(page);
        await input.fill(INITIAL_DRAFT);
        await page.getByRole("status").filter({ hasText: /Saving/ }).waitFor({ timeout: 5_000 });
        await waitForSaved(page);
        assert((await input.inputValue()) === INITIAL_DRAFT, "Acknowledged decimal draft changed locally before persistence proof.");
        await screenshot(page, "01-saved-draft");
        return { attemptId: state.attemptId };
      }
    },
    {
      name: "reload exact draft",
      run: async () => {
        const { page } = state.primary;
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByText("Question 1 of 2", { exact: true }).waitFor({ timeout: 20_000 });
        const input = await currentAnswerInput(page);
        assert((await input.inputValue()) === INITIAL_DRAFT, "Reload did not restore the exact server draft including whitespace/partial decimal text.");
        await waitForSaved(page);
        return { restored: true };
      }
    },
    {
      name: "fresh context server recovery",
      run: async () => {
        state.secondary = await loginWorker(browser, WORKER_A, "worker-a-secondary");
        const { page } = state.secondary;
        const response = await goto(page, `/worker/assessments/${state.attemptId}`);
        assert(response.status() === 200, `Fresh same-Worker context returned HTTP ${response.status()}.`);
        const input = await currentAnswerInput(page);
        assert((await input.inputValue()) === INITIAL_DRAFT, "Fresh authenticated context did not restore the server-owned draft.");
        await waitForSaved(page);
        return { restoredWithoutSharedBrowserContext: true };
      }
    },
    {
      name: "no browser persistence",
      run: async () => {
        const primary = await assertNoBrowserPersistence(state.primary.page, INITIAL_DRAFT);
        const secondary = await assertNoBrowserPersistence(state.secondary.page, INITIAL_DRAFT);
        return { primary, secondary };
      }
    },
    {
      name: "partial numeric draft round trip",
      run: async () => {
        const primaryInput = await currentAnswerInput(state.primary.page);
        const secondaryInput = await currentAnswerInput(state.secondary.page);
        assert((await primaryInput.getAttribute("inputmode")) === "decimal", "Decimal draft control lost inputMode=decimal.");
        assert((await primaryInput.getAttribute("type")) === "text", "Partial decimal draft was exposed through a coercing number input.");
        assert((await primaryInput.inputValue()) === INITIAL_DRAFT, "Primary context lost partial numeric draft text.");
        assert((await secondaryInput.inputValue()) === INITIAL_DRAFT, "Fresh context lost partial numeric draft text.");
        return { exactDraftLength: INITIAL_DRAFT.length };
      }
    },
    {
      name: "save and exit",
      run: async () => {
        const { page } = state.primary;
        const delayedPost = async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          await sleep(350);
          return route.continue();
        };
        await page.route("**/*", delayedPost);
        const input = await currentAnswerInput(page);
        await input.fill(SAVE_EXIT_DRAFT);
        const started = Date.now();
        await page.getByRole("button", { name: "Save and exit", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/worker/available-assessments`, { timeout: 20_000 });
        const elapsed = Date.now() - started;
        await page.unroute("**/*", delayedPost);
        assert(elapsed >= 250, `Save and exit navigated before the delayed server acknowledgement (${elapsed} ms).`);
        await page.getByRole("heading", { name: "In progress" }).waitFor({ timeout: 20_000 });
        return { waitedForAcknowledgementMs: elapsed };
      }
    },
    {
      name: "resume in progress",
      run: async () => {
        const { page } = state.primary;
        await page.getByRole("link", { name: "Resume assessment", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/worker/assessments/${state.attemptId}`, { timeout: 20_000 });
        const input = await currentAnswerInput(page);
        assert((await input.inputValue()) === SAVE_EXIT_DRAFT, "Resume did not restore the exact Save-and-exit draft.");
        await page.getByText("Question 1 of 2", { exact: true }).waitFor({ timeout: 20_000 });
        return { resumed: true };
      }
    },
    {
      name: "failed save blocks normal exit",
      run: async () => {
        const { page } = state.primary;
        const abortPosts = async (route) => {
          if (route.request().method() === "POST") return route.abort("failed");
          return route.continue();
        };
        allowExpectedNetworkFailures = true;
        await page.route("**/*", abortPosts);
        const input = await currentAnswerInput(page);
        await input.fill(FAILED_EXIT_DRAFT);
        await page.getByRole("button", { name: "Save and exit", exact: true }).click();
        await page.getByRole("status").filter({ hasText: /Not saved — reconnecting/ }).waitFor({ timeout: 10_000 });
        assert(new URL(page.url()).pathname === `/worker/assessments/${state.attemptId}`, "Failed Save and exit navigated away despite no server acknowledgement.");
        await page.unroute("**/*", abortPosts);
        allowExpectedNetworkFailures = false;
        await waitForSaved(page);
        assert((await input.inputValue()) === FAILED_EXIT_DRAFT, "Recovered autosave changed the local draft after failed normal exit.");
        return { remainedOnAttempt: true };
      }
    },
    {
      name: "emergency exit is bounded",
      run: async () => {
        const { page } = state.primary;
        const delayAndAbortPosts = async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          await sleep(2_500);
          try {
            await route.abort("failed");
          } catch {
            // Navigation may already have disposed the route; the bounded exit result is the evidence.
          }
        };
        allowExpectedNetworkFailures = true;
        await page.route("**/*", delayAndAbortPosts);
        const input = await currentAnswerInput(page);
        await input.fill(EMERGENCY_UNCONFIRMED_DRAFT);
        const started = Date.now();
        await page.getByRole("button", { name: "Emergency exit", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/worker/available-assessments`, { timeout: 5_000 });
        const elapsed = Date.now() - started;
        assert(elapsed < 1_800, `Emergency exit was blocked too long by an unreachable save (${elapsed} ms).`);
        await sleep(2_600);
        await page.unroute("**/*", delayAndAbortPosts);
        allowExpectedNetworkFailures = false;
        await page.getByRole("link", { name: "Resume assessment", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/worker/assessments/${state.attemptId}`, { timeout: 20_000 });
        await page.getByText("Question 1 of 2", { exact: true }).waitFor({ timeout: 20_000 });
        const resumed = await currentAnswerInput(page);
        assert((await resumed.inputValue()) === FAILED_EXIT_DRAFT, "Emergency exit falsely guaranteed an unacknowledged local edit as recoverable.");
        return { boundedExitMs: elapsed, currentPosition: 1 };
      }
    },
    {
      name: "same revision tab conflict",
      run: async () => {
        const primaryInput = await currentAnswerInput(state.primary.page);
        await primaryInput.fill(CONFLICT_WINNER_DRAFT);
        await waitForSaved(state.primary.page);

        const secondaryInput = await currentAnswerInput(state.secondary.page);
        await secondaryInput.fill(CONFLICT_LOSER_DRAFT);
        await state.secondary.page.getByRole("status").filter({ hasText: /^Conflict$/ }).waitFor({ timeout: 20_000 });
        await state.secondary.page.getByText("This draft changed in another tab. Choose which version to keep.", { exact: true }).waitFor({ timeout: 20_000 });
        assert((await secondaryInput.inputValue()) === CONFLICT_LOSER_DRAFT, "Conflict silently overwrote the losing tab's local value.");
        return { controlledConflict: true };
      }
    },
    {
      name: "explicit conflict resolution",
      run: async () => {
        const secondaryPage = state.secondary.page;
        const secondaryInput = await currentAnswerInput(secondaryPage);
        await secondaryPage.getByRole("button", { name: "Use saved version", exact: true }).click();
        assert((await secondaryInput.inputValue()) === CONFLICT_WINNER_DRAFT, "Use saved version did not deterministically adopt the server value.");
        await secondaryInput.fill(RESOLVED_SECONDARY_DRAFT);
        await waitForSaved(secondaryPage);

        const primaryPage = state.primary.page;
        const primaryInput = await currentAnswerInput(primaryPage);
        await primaryInput.fill(REPLACEMENT_DRAFT);
        await primaryPage.getByRole("status").filter({ hasText: /^Conflict$/ }).waitFor({ timeout: 20_000 });
        await primaryPage.getByRole("button", { name: "Replace saved version with this tab", exact: true }).click();
        await waitForSaved(primaryPage);
        assert((await primaryInput.inputValue()) === REPLACEMENT_DRAFT, "Explicit replacement changed the chosen local value.");
        await screenshot(primaryPage, "10-conflict-replaced");
        return { useSavedThenReplace: true };
      }
    },
    {
      name: "browser payload secrecy",
      run: async () => {
        state.preAdvanceTrafficEnd = traffic.length;
        const currentHtml = await state.primary.page.content();
        assert(!currentHtml.includes(WRITTEN_PROMPT), "Future question prompt leaked into current-question HTML before Next.");
        assertNoAssessmentSecrets(traffic.slice(0, state.preAdvanceTrafficEnd), { requireFuturePromptAbsent: true });
        return { inspectedRecords: state.preAdvanceTrafficEnd };
      }
    },
    {
      name: "next commits and advances once",
      run: async () => {
        const { page } = state.primary;
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await page.getByText("Question 2 of 2", { exact: true }).waitFor({ timeout: 20_000 });
        await page.getByText(WRITTEN_PROMPT, { exact: true }).waitFor({ timeout: 20_000 });
        await currentAnswerInput(page);
        const renderedBody = await page.locator("body").innerText();
        assert(!renderedBody.includes(DECIMAL_PROMPT), "Committed previous question remained exposed after advancing exactly one position.");
        await screenshot(page, "12-question-2");
        return { currentPosition: 2 };
      }
    },
    {
      name: "delayed old autosave rejected",
      run: async () => {
        const stalePage = state.secondary.page;
        const staleInput = await currentAnswerInput(stalePage);
        await staleInput.fill(DELAYED_OLD_DRAFT);
        await stalePage.getByRole("status").filter({ hasText: /^Conflict$/ }).waitFor({ timeout: 20_000 });
        await state.primary.page.reload({ waitUntil: "domcontentloaded" });
        await state.primary.page.getByText("Question 2 of 2", { exact: true }).waitFor({ timeout: 20_000 });
        assert(!((await state.primary.page.content()).includes(DELAYED_OLD_DRAFT)), "Delayed old-position autosave recreated or leaked an obsolete draft after advance.");
        return { staleOldPositionRejected: true };
      }
    },
    {
      name: "final submit clears draft",
      run: async () => {
        const { page } = state.primary;
        const input = await currentAnswerInput(page);
        await input.fill(FINAL_ANSWER);
        await waitForSaved(page);
        await page.getByRole("button", { name: "Submit assessment", exact: true }).click();
        await page.getByText("Assessment submitted", { exact: true }).waitFor({ timeout: 20_000 });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByText("Submission received. You may leave this page safely.", { exact: true }).waitFor({ timeout: 20_000 });
        assert((await page.getByLabel("Your answer").count()) === 0, "Submitted attempt still exposed a current draft answer control.");
        return { submitted: true };
      }
    },
    {
      name: "cross worker access denied",
      run: async () => {
        state.otherWorker = await loginWorker(browser, WORKER_B, "worker-b");
        const response = await goto(state.otherWorker.page, `/worker/assessments/${state.attemptId}`);
        const body = (await state.otherWorker.page.textContent("body")) ?? "";
        assert(response.status() === 404 || /not found|404/i.test(body), `Cross-Worker attempt probe was not denied; HTTP ${response.status()}.`);
        assert(!body.includes(DECIMAL_PROMPT) && !body.includes(WRITTEN_PROMPT), "Foreign Worker received protected assessment/draft content.");
        if (response.status() === 404) {
          consumeExpectedBrowserError("worker-b console: Failed to load resource: the server responded with a status of 404 (Not Found)");
        }
        await screenshot(state.otherWorker.page, "14-cross-worker-denied");
        return { crossWorkerStatus: response.status() };
      }
    },
    {
      name: "clean browser console",
      run: async () => {
        assertNoAssessmentSecrets(traffic);
        const hydrationErrors = unexpectedBrowserErrors.filter((value) => /hydration|did not match|server rendered html/i.test(value));
        assert(hydrationErrors.length === 0, `Unexpected hydration warning/error: ${hydrationErrors.join(" | ")}`);
        assert(unexpectedBrowserErrors.length === 0, `Unexpected browser console/page errors: ${unexpectedBrowserErrors.join(" | ")}`);
        return { consoleErrors: 0, pageErrors: 0 };
      }
    }
  ];

  try {
    for (const scenario of scenarios) {
      await checkpoint(scenario.name, scenario.run);
    }
    await writeFile(`${artifactsDir}/traffic-summary.json`, JSON.stringify(trafficSummary(), null, 2));
  } catch (error) {
    const page = state.primary?.page;
    if (page && !page.isClosed()) {
      try {
        await screenshot(page, "failure-state");
      } catch {
        // Preserve the original browser failure rather than replacing it with screenshot failure.
      }
    }
    throw error;
  } finally {
    await writeFile(`${artifactsDir}/results.json`, JSON.stringify(results, null, 2));
    if (state.otherWorker?.context) await state.otherWorker.context.close();
    if (state.secondary?.context) await state.secondary.context.close();
    if (state.primary?.context) await state.primary.context.close();
    await browser.close();
  }
}

if (process.argv.includes("--seed-only")) {
  await seedBrowserScenario();
} else {
  await runBrowserJourney();
}
