import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3000";
const WORKER_ID = "worker_id_PublicConcernFixture0001";
const artifactsDir = "artifacts/hard-browser-public-concern";
const results = [];

await mkdir(artifactsDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForReact(page) {
  await page.waitForFunction(() => document.querySelectorAll('script[src*="_next/static/chunks/"]').length > 0);
  await page.waitForFunction(() => typeof window.next !== "undefined" || document.readyState === "complete");
  await page.waitForTimeout(350);
}

async function waitForActionButton(page, name) {
  await page.waitForFunction(
    (buttonName) =>
      Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === buttonName && !button.disabled,
      ),
    name,
  );
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
    throw error;
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

try {
  await checkpoint("Public verification Report Concern submits through the real UI", async () => {
    const entry = await page.goto(`${BASE_URL}/verify`, { waitUntil: "domcontentloaded" });
    assert(entry && entry.status() < 500, "Public verification entry failed to load.");
    await waitForReact(page);
    await page.getByLabel("Worker ID or Credential ID").fill(WORKER_ID);
    await waitForActionButton(page, "Verify");
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await page.waitForURL(/\/verify\/result\//, { timeout: 15_000 });
    await page.getByText("Public verification result", { exact: true }).waitFor({ timeout: 15_000 });
    await page.getByText(WORKER_ID, { exact: true }).waitFor({ timeout: 15_000 });

    await page.getByRole("link", { name: "Report a credential concern", exact: true }).click();
    await page.waitForURL(/\/contact\?type=credential-concern&reference=/, { timeout: 15_000 });
    await page.getByLabel("Concern type").selectOption("status_dispute");
    await page.getByLabel("What is wrong?").fill(
      "Browser audit concern proving the public verification escalation workflow persists through the real server action."
    );
    await page.getByLabel("Email").fill("concern.reporter@example.test");
    await page.getByRole("button", { name: "Submit concern", exact: true }).click();

    const referenceLine = page.locator(".public-form-status p").filter({ hasText: "Concern reference:" });
    await referenceLine.waitFor({ state: "visible", timeout: 15_000 });
    const referenceText = (await referenceLine.innerText()).trim();
    assert(/Concern reference:\s*public_concern_[A-Za-z0-9_-]{24}/.test(referenceText), "Successful concern submission did not return the durable public concern reference shape.");
    assert(errors.length === 0, `Public concern browser errors: ${errors.join(" | ")}`);
    await page.screenshot({ path: `${artifactsDir}/m1-12-report-concern-success.png`, fullPage: true, caret: "initial" });
    return { workerIdentifier: "verified", concernReference: "opaque-returned", browserErrors: 0 };
  });
} catch (error) {
  await page.screenshot({ path: `${artifactsDir}/failure.png`, fullPage: true, caret: "initial" }).catch(() => undefined);
  throw error;
} finally {
  await writeFile(`${artifactsDir}/results.json`, JSON.stringify(results, null, 2), "utf8");
  await context.close();
  await browser.close();
}

if (results.some((result) => result.status !== "PASS")) process.exit(1);
