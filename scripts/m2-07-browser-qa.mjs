import { chromium } from "playwright";
import { createHash, randomBytes, scrypt as nodeScrypt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { openScriptDatabase } from "./lib/database.mjs";
import { readProjectEnvironment } from "./lib/environment.mjs";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3003";
const PASSWORD = "M207Browser!StrongPassword2026";
const WORKER_A = Object.freeze({
  email: "worker-a.m207.browser@example.test",
  displayName: "M2.07 Worker A"
});
const WORKER_B = Object.freeze({
  email: "worker-b.m207.browser@example.test",
  displayName: "M2.07 Worker B"
});
const MCQ_PROMPT = "Which control should be applied first for the M2.07 browser hazard scenario?";
const WRITTEN_PROMPT = "Briefly describe the next safe action for the M2.07 browser hazard scenario.";
const WRITTEN_RUBRIC_SECRET = "M207-RUBRIC-SECRET-SHOULD-NEVER-LEAK";
const MCQ_OPTIONS = Object.freeze(["Eliminate the hazard", "Ignore the hazard", "Delay the review"]);
const NOW = "2026-08-31T20:30:00.000Z";
const artifactsDir = "artifacts/m2-07-browser";
const results = [];
const scrypt = promisify(nodeScrypt);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix, seed) {
  return `${prefix}_${digest(`${prefix}:${seed}`).slice(0, 24)}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function passwordHash(password, pepper) {
  const salt = randomBytes(16);
  const derived = await scrypt(`${password}\u0000${pepper}`, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return [
    "scrypt",
    "16384",
    "8",
    "1",
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url")
  ].join("$");
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

async function insertWorker(database, seed, worker, pepper) {
  const accountId = `account_m207_browser_${digest(seed).slice(0, 18)}`;
  const workerReference = `M207-BROWSER-${seed.toUpperCase()}`;
  const hash = await passwordHash(PASSWORD, pepper);
  await database.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,worker_reference,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$6,$6,$6,$6)`,
    [accountId, worker.email, worker.displayName, hash, workerReference, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)`,
    [accountId, NOW]
  );
  return accountId;
}

export async function seedBrowserScenario() {
  const environment = readProjectEnvironment();
  assert(environment.databaseDriver === "pglite", "M2.07 browser seed requires the isolated PGlite test database.");
  assert(environment.pgliteDataDir && environment.pgliteDataDir !== "memory://", "M2.07 browser seed requires a persisted PGlite directory shared with Next.js.");

  const database = await openScriptDatabase(environment);
  try {
    const existing = await database.query(
      `SELECT account_id FROM auth_accounts WHERE email_normalized=$1`,
      [WORKER_A.email]
    );
    if (existing.rows.length > 0) {
      throw new Error("M2.07 browser seed database is not clean; refuse to reuse stale assessment state.");
    }

    const workerAId = await insertWorker(database, "worker-a", WORKER_A, environment.authPepper);
    await insertWorker(database, "worker-b", WORKER_B, environment.authPepper);

    const frameworkId = stableId("framework", "m207-browser");
    const blueprintId = stableId("assessment_blueprint", "m207-browser");
    const blueprintVersionId = stableId("blueprint_version", "m207-browser");
    const catalogueEntryId = stableId("assessment_catalogue", "m207-browser");
    const catalogueVersionId = stableId("catalogue_version", "m207-browser");
    const tenantId = stableId("tenant", "m207-browser");
    const orderId = stableId("assurance_order", "m207-browser");
    const targetId = stableId("assurance_target", "m207-browser");
    const caseId = stableId("assurance_case", "m207-browser");

    await database.query(
      `INSERT INTO assurance_frameworks(
         framework_id,framework_reference,title,framework_status,created_by_account_id,created_at,updated_at
       ) VALUES($1,'M207-BROWSER','M2.07 Browser Framework','ACTIVE',$2,$3,$3)`,
      [frameworkId, workerAId, NOW]
    );

    await database.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO assessment_blueprints(
           blueprint_id,blueprint_reference,blueprint_status,current_version_id,
           created_by_account_id,created_at,updated_at
         ) VALUES($1,'BP-M207-BROWSER','INACTIVE',NULL,$2,$3,$3)`,
        [blueprintId, workerAId, NOW]
      );
      await tx.query(
        `INSERT INTO assessment_blueprint_versions(
           blueprint_version_id,blueprint_id,version_no,framework_id,title,
           selectors_json,created_by_account_id,created_at
         ) VALUES($1,$2,1,$3,'M2.07 Browser Blueprint',$4::jsonb,$5,$6)`,
        [
          blueprintVersionId,
          blueprintId,
          frameworkId,
          JSON.stringify([
            { count: 1, questionType: "MULTIPLE_CHOICE", tagsAll: [] },
            { count: 1, questionType: "SHORT_TEXT", tagsAll: [] }
          ]),
          workerAId,
          NOW
        ]
      );
      await tx.query(
        `UPDATE assessment_blueprints
         SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3
         WHERE blueprint_id=$1`,
        [blueprintId, blueprintVersionId, NOW]
      );
    });

    await database.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO assessment_catalogue_entries(
           catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,
           created_by_account_id,created_at,updated_at
         ) VALUES($1,'CAT-M207-BROWSER','INACTIVE',NULL,$2,$3,$3)`,
        [catalogueEntryId, workerAId, NOW]
      );
      await tx.query(
        `INSERT INTO assessment_catalogue_versions(
           catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,
           blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at
         ) VALUES($1,$2,1,'M2.07 Browser Assessment','Real one-question browser proof',$3,$4,0,$5,$6)`,
        [catalogueVersionId, catalogueEntryId, frameworkId, blueprintVersionId, workerAId, NOW]
      );
      await tx.query(
        `UPDATE assessment_catalogue_entries
         SET current_version_id=$2,catalogue_status='ACTIVE',updated_at=$3
         WHERE catalogue_entry_id=$1`,
        [catalogueEntryId, catalogueVersionId, NOW]
      );
    });

    const questions = [
      {
        seed: "mcq",
        type: "MULTIPLE_CHOICE",
        prompt: MCQ_PROMPT,
        options: MCQ_OPTIONS,
        answerKey: MCQ_OPTIONS[0],
        rubric: null,
        domainReference: "Hazard Control"
      },
      {
        seed: "written",
        type: "SHORT_TEXT",
        prompt: WRITTEN_PROMPT,
        options: null,
        answerKey: null,
        rubric: { maxScore: 1, criteria: [{ description: WRITTEN_RUBRIC_SECRET, points: 1 }] },
        domainReference: "Safe Response"
      }
    ];

    for (const question of questions) {
      const questionId = stableId("assessment_question", `m207-browser-${question.seed}`);
      const questionVersionId = stableId("question_version", `m207-browser-${question.seed}`);
      const fingerprint = digest(`${question.type}:${question.prompt}:${JSON.stringify(question.options)}:${question.seed}`);
      await database.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO assessment_questions(
             question_id,question_reference,question_status,current_version_id,current_content_fingerprint,
             created_by_account_id,created_at,updated_at
           ) VALUES($1,$2,'INACTIVE',NULL,NULL,$3,$4,$4)`,
          [questionId, `M207-Q-${question.seed.toUpperCase()}`, workerAId, NOW]
        );
        await tx.query(
          `INSERT INTO assessment_question_versions(
             question_version_id,question_id,version_no,question_type,prompt,options_json,
             answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
             content_fingerprint,created_by_account_id,created_at
           ) VALUES($1,$2,1,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,'MEDIUM','[]'::jsonb,$10,$11,$12)`,
          [
            questionVersionId,
            questionId,
            question.type,
            question.prompt,
            question.options === null ? null : JSON.stringify(question.options),
            question.answerKey === null ? null : JSON.stringify(question.answerKey),
            question.rubric === null ? null : JSON.stringify(question.rubric),
            frameworkId,
            question.domainReference,
            fingerprint,
            workerAId,
            NOW
          ]
        );
        await tx.query(
          `UPDATE assessment_questions
           SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE',updated_at=$4
           WHERE question_id=$1`,
          [questionId, questionVersionId, fingerprint, NOW]
        );
      });
    }

    const workerLinkId = `worker_link_${digest("m207-browser-link").slice(0, 24)}`;
    const membershipId = `membership_${digest("m207-browser-membership").slice(0, 24)}`;
    await database.query(
      `INSERT INTO assurance_orders(
         order_id,tenant_id,created_by_membership_id,order_name,order_reference,
         requested_identity_checks,requested_evidence_checks,assessment_framework_references,
         interview_required,order_status,validation_errors,scope_version,created_at,updated_at
       ) VALUES($1,$2,$3,'M2.07 Browser Order','M207-BROWSER-ORDER',
                '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,FALSE,'DRAFT','[]'::jsonb,1,$4,$4)`,
      [orderId, tenantId, membershipId, NOW]
    );
    await database.query(
      `INSERT INTO assurance_order_workers(
         target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,
         target_status,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,'company','eligible',$6,$6)`,
      [targetId, orderId, tenantId, workerLinkId, workerAId, NOW]
    );
    await database.query(
      `INSERT INTO assurance_cases(
         case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
         case_status,owner_kind,next_action,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,'Assessment pending','worker','View available assessments',$7,$7)`,
      [caseId, orderId, targetId, tenantId, workerLinkId, workerAId, NOW]
    );
    await database.query(
      `INSERT INTO assurance_case_policy_snapshots(
         snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,
         tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at,
         created_by_account_id
       ) VALUES($1,$2,$3,$4,$5,$6,NULL,'GLOBAL','{}'::jsonb,$7,$7,NULL)`,
      [
        stableId("policy_snapshot", "m207-browser"),
        caseId,
        tenantId,
        frameworkId,
        stableId("policy", "m207-browser"),
        stableId("policy_version", "m207-browser"),
        NOW
      ]
    );

    const seeded = {
      caseId,
      catalogueVersionId,
      frameworkId,
      workerA: WORKER_A.email,
      workerB: WORKER_B.email,
      questionOrder: ["MULTIPLE_CHOICE", "SHORT_TEXT"]
    };
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(`${artifactsDir}/seed.json`, JSON.stringify(seeded, null, 2));
    console.log(`Seeded M2.07 browser scenario for case ${caseId}.`);
    return seeded;
  } finally {
    await database.close();
  }
}

async function goto(page, path) {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  assert(response, `${path} returned no response.`);
  return response;
}

async function loginWorker(browser, credentials, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
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

function captureAssessmentTraffic(page) {
  const records = [];
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.origin !== BASE_URL) return;
      if (request.method() !== "POST") return;
      const body = request.postData();
      if (body) records.push({ kind: "request", url: request.url(), body });
    } catch {
      // Ignore malformed/unrelated browser requests.
    }
  });
  page.on("response", async (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin !== BASE_URL) return;
      const contentType = response.headers()["content-type"] ?? "";
      if (!/(?:text\/html|text\/x-component|application\/json)/i.test(contentType)) return;
      const body = await response.text();
      records.push({ kind: "response", url: response.url(), status: response.status(), contentType, body });
    } catch {
      // Navigation can cancel a body read; absence is safer than treating it as evidence.
    }
  });
  return records;
}

async function assertFuturePromptAbsent(page, futurePrompt, records) {
  const html = await page.content();
  assert(!html.includes(futurePrompt), "Future question prompt leaked into rendered HTML before current answer commit.");
  for (const record of records) {
    assert(!record.body.includes(futurePrompt), `Future question prompt leaked through ${record.kind} payload ${record.url}.`);
  }
}

async function assertNoAssessmentSecrets(page, records) {
  const delivered = [await page.content(), ...records.map((record) => record.body)];
  const forbidden = [
    { pattern: /["']?answerKey["']?\s*[:=]|answer_key/i, label: "answerKey/answer_key" },
    { pattern: /["']?rubric["']?\s*[:=]/i, label: "rubric" },
    { pattern: /["']?score["']?\s*[:=]/i, label: "score" },
    { pattern: /["']?correctness["']?\s*[:=]/i, label: "correctness" },
    { pattern: new RegExp(WRITTEN_RUBRIC_SECRET, "i"), label: "written rubric sentinel" },
    // Internal attempt metadata is server-only and must never cross the browser projection boundary.
    { pattern: /["']workerAccountId["']\s*[:=]/i, label: "internal attempt metadata workerAccountId" },
    { pattern: /["']formId["']\s*[:=]/i, label: "internal attempt metadata formId" },
    { pattern: /["']startedAt["']\s*[:=]/i, label: "internal attempt metadata startedAt" }
  ];
  for (const body of delivered) {
    for (const item of forbidden) {
      assert(!item.pattern.test(body), `Forbidden assessment secret marker leaked to browser: ${item.label}.`);
    }
  }
}

async function runBrowserJourney() {
  await mkdir(artifactsDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let workerA;
  try {
    workerA = await checkpoint("login real Worker A", () =>
      loginWorker(browser, WORKER_A, "primary")
    );
    const { page } = workerA;
    const traffic = captureAssessmentTraffic(page);

    let attemptId;
    await checkpoint("start eligible assessment and receive only MULTIPLE_CHOICE question one", async () => {
      const response = await goto(page, "/worker/available-assessments");
      assert(response.status() === 200, `Available assessments returned HTTP ${response.status()}.`);
      await page.getByRole("heading", { name: "M2.07 Browser Assessment" }).waitFor({ timeout: 20_000 });
      await assertFuturePromptAbsent(page, WRITTEN_PROMPT, traffic);
      await page.getByRole("button", { name: "Start assessment" }).click();
      await page.waitForURL(/\/worker\/assessments\/assessment_attempt_[A-Za-z0-9_-]{24}$/, { timeout: 20_000 });
      attemptId = page.url().split("/").pop();
      assert(attemptId && /^assessment_attempt_[A-Za-z0-9_-]{24}$/.test(attemptId), "Assessment attempt ID was not created by the visible Start assessment action.");
      await page.getByText("Question 1 of 2", { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByText(MCQ_PROMPT, { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByLabel(MCQ_OPTIONS[0]).waitFor({ state: "visible", timeout: 20_000 });
      await assertFuturePromptAbsent(page, WRITTEN_PROMPT, traffic);
      await assertNoAssessmentSecrets(page, traffic);
      await page.screenshot({ path: `${artifactsDir}/question-1-mcq.png`, fullPage: true });
      return { attemptId, firstType: "MULTIPLE_CHOICE" };
    });

    await checkpoint("commit MCQ before revealing SHORT_TEXT and recover committed position on reload", async () => {
      await page.getByLabel(MCQ_OPTIONS[0]).check();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByText("Question 2 of 2", { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByText(WRITTEN_PROMPT, { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByLabel("Your answer").waitFor({ state: "visible", timeout: 20_000 });
      await assertNoAssessmentSecrets(page, traffic);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Question 2 of 2", { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByText(WRITTEN_PROMPT, { exact: true }).waitFor({ timeout: 20_000 });
      await assertNoAssessmentSecrets(page, traffic);
      await page.screenshot({ path: `${artifactsDir}/question-2-after-reload.png`, fullPage: true });
      return { recoveredPosition: 2, secondType: "SHORT_TEXT" };
    });

    await checkpoint("deny cross-Worker direct attempt access", async () => {
      const otherWorker = await loginWorker(browser, WORKER_B, "second Worker");
      try {
        const crossWorkerUrl = `/worker/assessments/${attemptId}`;
        const response = await goto(otherWorker.page, crossWorkerUrl);
        const body = (await otherWorker.page.textContent("body")) ?? "";
        assert(
          response.status() === 404 || /not found|404/i.test(body),
          `Cross-Worker attempt request was not denied; HTTP ${response.status()}.`
        );
        assert(!body.includes(MCQ_PROMPT) && !body.includes(WRITTEN_PROMPT), "Other Worker received protected assessment question content.");
        await otherWorker.page.screenshot({ path: `${artifactsDir}/cross-worker-denied.png`, fullPage: true });
        return { crossWorkerStatus: response.status() };
      } finally {
        await otherWorker.context.close();
      }
    });

    await checkpoint("submit written answer and render submitted receipt without assessment secrets", async () => {
      await page.getByLabel("Your answer").fill("Stop the activity, control the hazard, and verify the area is safe before resuming.");
      await page.getByRole("button", { name: "Submit assessment" }).click();
      await page.getByText("Assessment submitted", { exact: true }).waitFor({ timeout: 20_000 });
      await page.getByText("Submission received. You may leave this page safely.", { exact: true }).waitFor({ timeout: 20_000 });
      await assertNoAssessmentSecrets(page, traffic);
      await page.screenshot({ path: `${artifactsDir}/submitted.png`, fullPage: true });
      return { submitted: true };
    });

    const safeTraffic = traffic.map((record) => ({
      kind: record.kind,
      url: record.url,
      ...(record.status ? { status: record.status } : {}),
      ...(record.contentType ? { contentType: record.contentType } : {}),
      bodyLength: record.body.length
    }));
    await writeFile(`${artifactsDir}/traffic-summary.json`, JSON.stringify(safeTraffic, null, 2));
  } finally {
    await writeFile(`${artifactsDir}/results.json`, JSON.stringify(results, null, 2));
    if (workerA?.context) await workerA.context.close();
    await browser.close();
  }
}

if (process.argv.includes("--seed-only")) {
  await seedBrowserScenario();
} else {
  await runBrowserJourney();
}
