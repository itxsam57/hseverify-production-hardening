import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3000";
const PASSWORD = "RetrospectiveQA!StrongPassword2026";
const WORKER_EMAIL = "worker.retrospective.qa@example.test";
const artifactsDir = "artifacts/hard-browser-retrospective-evidence";
const results = [];
const PDF_FIXTURE = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf8"
);

await mkdir(artifactsDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function checkpoint(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", ms: Date.now() - started, detail: detail ?? null });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, status: "FAIL", ms: Date.now() - started, error: message });
    console.error(`FAIL ${name}: ${message}`);
    throw error;
  }
}

function trackErrors(page, label) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} console: ${message.text()}`);
  });
  return errors;
}

async function gotoOk(page, path, expectedText) {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  assert(response, `${path} returned no response`);
  assert(response.status() < 500, `${path} returned HTTP ${response.status()}`);
  if (expectedText) {
    await page.getByText(expectedText, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
  }
}

async function loginWorker(page) {
  await gotoOk(page, "/worker/login", "Worker sign in");
  await page.getByLabel("Email address").fill(WORKER_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/worker/") && url.pathname !== "/worker/login", { timeout: 15_000 });
}

async function waitForCard(page, title) {
  const card = page.locator("article").filter({ hasText: title }).first();
  await card.waitFor({ state: "visible", timeout: 15_000 });
  return card;
}

async function waitForQualificationUploadOutcome(card) {
  const immediate = card.getByText("Certificate uploaded, security-scanned and bound to this qualification version.", { exact: true });
  const queued = card.getByText("File uploaded and queued for security scanning.", { exact: false });
  const first = await Promise.race([
    immediate.waitFor({ state: "visible", timeout: 15_000 }).then(() => "bound").catch(() => null),
    queued.waitFor({ state: "visible", timeout: 15_000 }).then(() => "queued").catch(() => null)
  ]);
  if (first === "bound") return "bound";
  if (first !== "queued") {
    throw new Error("Secure qualification PDF upload produced neither a bound nor queued success state.");
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const button = card.getByRole("button", { name: "Check scan status" }).first();
    if ((await button.count()) === 0) break;
    await button.click();
    const finalized = card.getByText(
      "Security scan passed and the evidence file is now attached to this exact record version.",
      { exact: true }
    );
    if (await finalized.isVisible().catch(() => false)) return "finalized-after-queue";
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Qualification PDF remained unbound after visible scan-finalization attempts.");
}

async function waitForLeavingLetterOutcome(card) {
  const immediate = card.getByText("Leaving letter uploaded, security-scanned and bound to this ended employment.", { exact: true });
  const queued = card.getByText("Leaving letter uploaded and queued for security scanning.", { exact: false });
  const first = await Promise.race([
    immediate.waitFor({ state: "visible", timeout: 15_000 }).then(() => "bound").catch(() => null),
    queued.waitFor({ state: "visible", timeout: 15_000 }).then(() => "queued").catch(() => null)
  ]);
  if (first === "bound") return "bound";
  if (first !== "queued") {
    throw new Error("Leaving-letter PDF upload produced neither a bound nor queued success state.");
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const button = card.getByRole("button", { name: "Check scan status" }).first();
    if ((await button.count()) === 0) break;
    await button.click();
    const finalized = card.getByText(
      "Security scan passed and the leaving letter is now attached to this employment.",
      { exact: true }
    );
    if (await finalized.isVisible().catch(() => false)) return "finalized-after-queue";
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Leaving-letter PDF remained unbound after visible scan-finalization attempts.");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = trackErrors(page, "worker-evidence");

try {
  await checkpoint("Worker evidence records preserve history through visible workflow", async () => {
    await loginWorker(page);
    await gotoOk(page, "/worker/evidence", "Create a Worker record");

    await page.getByLabel("Record type").selectOption("qualification");
    await page.getByRole("button", { name: "Create draft" }).click();
    let qualification = await waitForCard(page, "Qualification record");

    await qualification.getByLabel("Qualification title").fill("NEBOSH International General Certificate");
    await qualification.getByLabel("Category").fill("Occupational safety and health");
    await qualification.getByLabel("Issuing organization").fill("NEBOSH");
    await qualification.getByLabel("Learning provider").fill("Retrospective QA Provider");
    await qualification.getByLabel("Certificate / candidate number").fill("QA-NEBOSH-2026-001");
    await qualification.getByLabel("Issue date").fill("2024-06-15");
    await qualification.getByLabel("Level").fill("International General Certificate");
    await qualification.getByLabel("Country").fill("Pakistan");
    await qualification.getByRole("checkbox").check();
    await qualification.getByRole("button", { name: "Save metadata" }).click();
    await qualification.getByRole("status").filter({ hasText: "Draft metadata saved with its current version." }).waitFor({ state: "visible", timeout: 15_000 });

    qualification = await waitForCard(page, "Qualification record");
    await qualification.getByLabel("Primary certificate file").setInputFiles({
      name: "retrospective-qualification.pdf",
      mimeType: "application/pdf",
      buffer: PDF_FIXTURE
    });
    await qualification.getByRole("button", { name: "Upload file" }).click();
    const qualificationUploadPath = await waitForQualificationUploadOutcome(qualification);

    qualification = await waitForCard(page, "Qualification record");
    await qualification.getByRole("button", { name: "Submit this version" }).click();
    qualification = await waitForCard(page, "Qualification record");
    await qualification.getByText("active · submitted", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    let qualificationHistory = qualification.getByRole("region", { name: "qualification history" });
    await qualificationHistory.getByText(/Version 1 .* submitted/i).waitFor({ state: "visible", timeout: 15_000 });
    await qualificationHistory.getByText(/retrospective-qualification\.pdf .* active/i).waitFor({ state: "visible", timeout: 15_000 });

    await qualification.getByRole("button", { name: "Start a new revision" }).click();
    qualification = await waitForCard(page, "Qualification record");
    qualificationHistory = qualification.getByRole("region", { name: "qualification history" });
    await qualificationHistory.getByText(/Version 1 .* submitted/i).waitFor({ state: "visible", timeout: 15_000 });
    await qualificationHistory.getByText(/Version 2 .* draft/i).waitFor({ state: "visible", timeout: 15_000 });
    await qualificationHistory.getByText(/retrospective-qualification\.pdf .* active/i).waitFor({ state: "visible", timeout: 15_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    qualification = await waitForCard(page, "Qualification record");
    qualificationHistory = qualification.getByRole("region", { name: "qualification history" });
    await qualificationHistory.getByText(/Version 1 .* submitted/i).waitFor({ state: "visible", timeout: 15_000 });
    await qualificationHistory.getByText(/Version 2 .* draft/i).waitFor({ state: "visible", timeout: 15_000 });
    await qualificationHistory.getByText(/retrospective-qualification\.pdf .* active/i).waitFor({ state: "visible", timeout: 15_000 });

    await page.getByLabel("Record type").selectOption("employment");
    await page.getByRole("button", { name: "Create draft" }).click();
    let employment = await waitForCard(page, "Employment record");
    await employment.getByLabel("Employer").fill("Retrospective Industrial Services");
    await employment.getByLabel("Role title").fill("Safety Officer");
    await employment.getByLabel("Country").fill("Saudi Arabia");
    await employment.getByLabel("Start date").fill("2022-01-10");
    await employment.getByLabel("Duties").fill("Site inspections, permit checks, toolbox talks and incident prevention.");
    await employment.getByRole("button", { name: "Save metadata" }).click();
    await employment.getByRole("status").filter({ hasText: "Draft metadata saved with its current version." }).waitFor({ state: "visible", timeout: 15_000 });

    employment = await waitForCard(page, "Employment record");
    await employment.getByRole("button", { name: "Submit this version" }).click();
    employment = await waitForCard(page, "Employment record");
    await employment.getByText("active · submitted", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    let employmentHistory = employment.getByRole("region", { name: "employment history" });
    await employmentHistory.getByText(/Version 1 .* submitted/i).waitFor({ state: "visible", timeout: 15_000 });

    await employment.getByLabel("Employment end date").fill("2025-12-31");
    await employment.getByLabel("End reason").fill("Project assignment completed.");
    await employment.getByRole("button", { name: "End employment and preserve history" }).click();
    employment = await waitForCard(page, "Employment record");
    await employment.getByText("ended · submitted", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    employmentHistory = employment.getByRole("region", { name: "employment history" });
    await employmentHistory.getByText(/Version 1 .* superseded/i).waitFor({ state: "visible", timeout: 15_000 });
    await employmentHistory.getByText(/Version 2 .* submitted/i).waitFor({ state: "visible", timeout: 15_000 });

    await employment.getByLabel("Leaving letter file").setInputFiles({
      name: "retrospective-leaving-letter.pdf",
      mimeType: "application/pdf",
      buffer: PDF_FIXTURE
    });
    await employment.getByRole("button", { name: "Upload leaving letter" }).click();
    const leavingLetterUploadPath = await waitForLeavingLetterOutcome(employment);

    await page.reload({ waitUntil: "domcontentloaded" });
    employment = await waitForCard(page, "Employment record");
    employmentHistory = employment.getByRole("region", { name: "employment history" });
    await employmentHistory.getByText(/Version 1 .* superseded/i).waitFor({ state: "visible", timeout: 15_000 });
    await employmentHistory.getByText(/Version 2 .* submitted/i).waitFor({ state: "visible", timeout: 15_000 });
    await employmentHistory.getByText(/Leaving letter: retrospective-leaving-letter\.pdf .* active/i).waitFor({ state: "visible", timeout: 15_000 });

    await page.screenshot({
      path: `${artifactsDir}/worker-evidence-pdf-employment-history.png`,
      fullPage: true,
      caret: "initial"
    });
    assert(errors.length === 0, `Worker evidence browser errors: ${errors.join(" | ")}`);
    return {
      qualificationUploadPath,
      qualificationVersionsPreserved: [1, 2],
      employmentVersionsPreserved: [1, 2],
      leavingLetterUploadPath
    };
  });
} catch (error) {
  try {
    await page.screenshot({ path: `${artifactsDir}/failure.png`, fullPage: true, caret: "initial" });
  } catch {
    // Preserve original error.
  }
  throw error;
} finally {
  await writeFile(`${artifactsDir}/results.json`, JSON.stringify(results, null, 2), "utf8");
  await context.close().catch(() => {});
  await browser.close();
}

if (results.some((result) => result.status !== "PASS")) process.exit(1);
