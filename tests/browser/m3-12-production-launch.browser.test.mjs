import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const STAFF_PASSWORD = "M312BrowserStaff!2026";
const SANDBOX_KEY = "m3-12-browser-sandbox-key-2026";
const CHECKS = ["runbook", "support", "alerts", "rollback", "acceptance"];

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an M3.12 browser-test port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function trackBrowserErrors(page, label) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} console: ${message.text()}`);
  });
  return errors;
}

async function gotoOk(page, baseUrl, path, expectedText) {
  const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  assert(response, `${path} returned no response`);
  assert(response.status() < 500, `${path} returned HTTP ${response.status()}`);
  if (expectedText) {
    await page.getByText(expectedText, { exact: false }).first().waitFor({
      state: "visible",
      timeout: 15_000
    });
  }
}

async function enrollStaff(browser, baseUrl, invitationPath, role, email, displayName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = trackBrowserErrors(page, `${role}-enrollment`);
  await gotoOk(page, baseUrl, invitationPath, "Create account credentials");
  await page.getByLabel("Full name").fill(displayName);
  await page.getByLabel("Create password").fill(STAFF_PASSWORD);
  await page.getByLabel("Confirm password").fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "Continue to authenticator setup" }).click();
  await page.getByText("Add HSE Verify to an authenticator app", { exact: false }).waitFor({ timeout: 15_000 });
  const secret = (await page.locator(".security-key-card strong").innerText()).trim();
  assert(secret.length >= 16);
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Activate MFA and finish enrollment" }).click();
  await page.getByText("Enrollment complete", { exact: false }).waitFor({ timeout: 15_000 });
  assert.deepEqual(errors, []);
  await context.close();
  return { role, email, secret };
}

async function loginStaff(browser, baseUrl, identity) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = trackBrowserErrors(page, `${identity.role}-login`);
  await gotoOk(page, baseUrl, `/${identity.role}/login`, "sign in");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(STAFF_PASSWORD);
  await page.getByLabel("Authenticator code").fill(totp(identity.secret, 1));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith(`/${identity.role}/`) && url.pathname !== `/${identity.role}/login`,
    { timeout: 15_000 }
  );
  return { context, page, errors };
}

async function bootstrapAdmin(browser, baseUrl) {
  const bootstrapContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bootstrapPage = await bootstrapContext.newPage();
  await gotoOk(bootstrapPage, baseUrl, "/auth/sandbox/bootstrap-root", "Create the one-time invitation");
  await bootstrapPage.getByLabel("First root email").fill("root.m312.browser@example.test");
  await bootstrapPage.getByLabel("Authentication sandbox access key").fill(SANDBOX_KEY);
  await bootstrapPage.getByRole("button", { name: "Create first root invitation" }).click();
  const rootInvitation = (await bootstrapPage.locator(".security-key-card strong").innerText()).trim();
  assert(rootInvitation.startsWith("/staff/invite/"));
  await bootstrapContext.close();

  const root = await enrollStaff(
    browser,
    baseUrl,
    rootInvitation,
    "root",
    "root.m312.browser@example.test",
    "M3.12 Browser Root"
  );
  const rootSession = await loginStaff(browser, baseUrl, root);
  await gotoOk(rootSession.page, baseUrl, "/root/staff", "Create invitation");
  await rootSession.page.getByLabel("Staff email").fill("admin.m312.browser@example.test");
  await rootSession.page.getByLabel("Portal role").selectOption("admin");
  await rootSession.page.getByRole("button", { name: "Create one-time invitation" }).click();
  const adminInvitation = (await rootSession.page.locator(".security-key-card strong").first().innerText()).trim();
  assert(adminInvitation.startsWith("/staff/invite/"));
  await rootSession.context.close();

  const admin = await enrollStaff(
    browser,
    baseUrl,
    adminInvitation,
    "admin",
    "admin.m312.browser@example.test",
    "M3.12 Browser Admin"
  );
  return loginStaff(browser, baseUrl, admin);
}

async function expectCheck(page, name, status, revision) {
  const row = page.locator(`[data-handover-check="${name}"]`);
  await row.waitFor({ state: "visible", timeout: 15_000 });
  assert.equal((await row.getByLabel(`${name} current status`).innerText()).trim(), status);
  assert.equal((await row.getByLabel(`${name} revision`).innerText()).trim(), `Revision ${revision}`);
  return row;
}

async function saveCheck(page, name, status) {
  const row = page.locator(`[data-handover-check="${name}"]`);
  await row.getByLabel(`${name} handover status`).selectOption(status);
  await row.getByRole("button", { name: `Save ${name} handover` }).click();
  await page.waitForURL(/\/admin\/operations\?result=updated$/, { timeout: 15_000 });
  await page.getByRole("status").filter({ hasText: "Handover check saved." }).waitFor({ timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function runBrowserAcceptance(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  let adminSession = null;
  let stalePage = null;
  try {
    const anonymous = await browser.newPage();
    await gotoOk(anonymous, baseUrl, "/admin/operations", null);
    assert.match(anonymous.url(), /\/admin\/login/);
    await anonymous.close();

    adminSession = await bootstrapAdmin(browser, baseUrl);
    const { page } = adminSession;
    await gotoOk(page, baseUrl, "/admin/operations", "Production launch and operational handover");
    assert.equal((await page.getByLabel("release-readiness-status").innerText()).trim(), "Release readiness: attention");
    for (const name of CHECKS) await expectCheck(page, name, "pending", 0);

    stalePage = await adminSession.context.newPage();
    const staleErrors = trackBrowserErrors(stalePage, "admin-stale-tab");
    await gotoOk(stalePage, baseUrl, "/admin/operations", "Production launch and operational handover");
    await expectCheck(stalePage, "runbook", "pending", 0);

    await saveCheck(page, "runbook", "passed");
    await expectCheck(page, "runbook", "passed", 1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectCheck(page, "runbook", "passed", 1);

    const staleRunbook = stalePage.locator('[data-handover-check="runbook"]');
    await staleRunbook.getByLabel("runbook handover status").selectOption("failed");
    await staleRunbook.getByRole("button", { name: "Save runbook handover" }).click();
    await stalePage.waitForURL(/\/admin\/operations\?result=conflict$/, { timeout: 15_000 });
    await stalePage.getByRole("alert").filter({ hasText: "Handover state changed" }).waitFor({ timeout: 15_000 });
    await expectCheck(stalePage, "runbook", "passed", 1);

    for (const name of CHECKS.slice(1)) {
      await saveCheck(page, name, "passed");
      await expectCheck(page, name, "passed", 1);
    }
    assert.equal((await page.getByLabel("release-readiness-status").innerText()).trim(), "Release readiness: ready");
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal((await page.getByLabel("release-readiness-status").innerText()).trim(), "Release readiness: ready");
    for (const name of CHECKS) await expectCheck(page, name, "passed", 1);
    await page.getByText("production_launch.handover.updated", { exact: false }).first().waitFor({ timeout: 15_000 });

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(overflow <= 1, `Admin operations page overflows mobile by ${overflow}px`);

    assert.deepEqual(staleErrors, []);
    assert.deepEqual(adminSession.errors, []);
  } finally {
    await stalePage?.close();
    await adminSession?.context.close();
    await browser.close();
  }
}

test("M3.12 real Chromium acceptance persists production handover, reports stale updates, and reaches durable readiness", { timeout: 240_000 }, async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-m312-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "m3-12-browser-local",
    HSE_SESSION_SECRET: "m3-12-browser-session-secret-2026-000000000000",
    HSE_AUTH_PEPPER: "m3-12-browser-auth-pepper-2026-00000000000000",
    HSE_ENABLE_AUTH_SANDBOX: "true",
    HSE_AUTH_SANDBOX_ACCESS_KEY: SANDBOX_KEY,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: projectRoot,
      env: environment,
      encoding: "utf8"
    });
    assert.equal(
      migration.status,
      0,
      `M3.12 browser database migration failed.\n${migration.stdout ?? ""}\n${migration.stderr ?? ""}`
    );

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/admin/login`,
      projectRoot,
      environment,
      probe: async ({ initialResponse, output }) => {
        assert.equal(initialResponse.status, 200);
        try {
          await runBrowserAcceptance(baseUrl);
        } catch (error) {
          console.error(output());
          throw error;
        }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
