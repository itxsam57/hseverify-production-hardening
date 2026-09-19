import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const EMAIL = "worker.complete.browser@example.test";
const PHONE = "+923009876543";
const PASSWORD = "WorkerComplete!2026";
const SANDBOX_KEY = "worker-complete-browser-sandbox-2026";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a Worker browser-test port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function sandboxCode(page, baseUrl, channel, destination) {
  await page.goto(`${baseUrl}/worker/register/sandbox`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Delivery channel").selectOption(channel);
  await page.getByLabel("Delivery destination").fill(destination);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest sandbox delivery" }).click();
  const result = page.getByRole("status", { name: "Latest sandbox verification code" });
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await result.locator("strong").innerText()).trim();
  assert.match(code, /^\d{6}$/);
  return code;
}

test("Worker completes registration, both contact checks, login and profile submission in Chromium", { timeout: 240_000 }, async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-worker-complete-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "worker-complete-browser-local",
    HSE_SESSION_SECRET: "worker-complete-session-secret-2026-000000000",
    HSE_AUTH_PEPPER: "worker-complete-auth-pepper-2026-00000000000",
    HSE_ENABLE_AUTH_SANDBOX: "true",
    HSE_AUTH_SANDBOX_ACCESS_KEY: SANDBOX_KEY,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: projectRoot, env: environment, encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/worker/register`,
      projectRoot,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        try {
          await page.goto(`${baseUrl}/worker/register`, { waitUntil: "domcontentloaded" });
          await page.getByLabel("Full name").fill("Worker Complete");
          await page.getByLabel("Email address").fill(EMAIL);
          await page.getByLabel("Mobile phone").fill(PHONE);
          await page.getByLabel("Create password").fill(PASSWORD);
          await page.getByLabel("Confirm password").fill(PASSWORD);
          await page.getByRole("button", { name: "Create Worker account" }).click();
          await page.waitForURL(/\/worker\/register\/verify/, { timeout: 15_000 });

          const emailCode = await sandboxCode(page, baseUrl, "email", EMAIL);
          await page.goto(`${baseUrl}/worker/register/verify`, { waitUntil: "domcontentloaded" });
          await page.getByLabel("Verification code").fill(emailCode);
          await page.getByRole("button", { name: "Verify email" }).click();
          await page.getByText("Step 2 of 2: phone", { exact: true }).waitFor({ timeout: 15_000 });

          const phoneCode = await sandboxCode(page, baseUrl, "phone", PHONE);
          await page.goto(`${baseUrl}/worker/register/verify`, { waitUntil: "domcontentloaded" });
          await page.getByLabel("Verification code").fill(phoneCode);
          await page.getByRole("button", { name: "Verify phone" }).click();
          await page.waitForURL(/\/worker\/register\/verify\?stage=complete/, { timeout: 15_000 });
          await page.getByText("Email and phone verification passed.", { exact: true }).waitFor();
          await page.getByRole("link", { name: "Worker sign-in", exact: true }).click();
          await page.waitForURL(/\/worker\/login/, { timeout: 15_000 });

          await page.getByLabel("Email address").fill(EMAIL);
          await page.getByLabel("Password").fill(PASSWORD);
          await page.getByRole("button", { name: "Sign in", exact: true }).click();
          await page.waitForURL(/\/worker\/(dashboard|onboarding)/, { timeout: 15_000 });

          await page.goto(`${baseUrl}/worker/profile?section=personal`, { waitUntil: "domcontentloaded" });
          await page.getByLabel("Legal first name").fill("Worker");
          await page.getByLabel("Legal last name").fill("Complete");
          await page.getByLabel("Preferred name").fill("WC");
          await page.getByLabel("Date of birth").fill("1990-01-15");
          await page.getByLabel("Nationality").fill("Pakistani");
          await page.getByLabel("Country of residence").fill("Pakistan");
          await page.getByLabel("Primary language").fill("English");
          await page.getByRole("button", { name: "Save and continue" }).click();
          await page.waitForURL(/section=contact/, { timeout: 15_000 });

          await page.getByLabel("Country code").fill("+92");
          await page.getByLabel("Phone number").fill("3009876543");
          await page.getByLabel("Address line 1").fill("1 Safety Street");
          await page.getByLabel("City").fill("Islamabad");
          await page.getByLabel("Region or province").fill("ICT");
          await page.getByLabel("Postal code").fill("44000");
          await page.getByRole("button", { name: "Save and continue" }).click();
          await page.waitForURL(/section=professional/, { timeout: 15_000 });

          await page.getByLabel("Primary occupation or trade").fill("Safety Officer");
          await page.getByLabel("Years of experience").fill("7");
          await page.getByLabel("Current employment status").selectOption("employed");
          await page.getByLabel("Preferred work countries").fill("Saudi Arabia, Pakistan");
          await page.getByLabel("I am willing to relocate for suitable work.").check();
          await page.getByRole("button", { name: "Save changes" }).click();
          await page.getByText("Profile section saved.", { exact: true }).waitFor({ timeout: 15_000 });
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByRole("button", { name: "Submit profile" }).click();
          await page.getByText("Profile submitted", { exact: true }).waitFor({ timeout: 15_000 });
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByText("Profile submitted", { exact: true }).waitFor({ timeout: 15_000 });

          assert.deepEqual(errors.filter((error) => !error.includes("favicon")), []);
        } finally {
          await context.close();
          await browser.close();
        }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
