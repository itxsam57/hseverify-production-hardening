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

const COMPANY_EMAIL = "m108.browser.company@example.test";
const COMPANY_PASSWORD = "M108BrowserCompany!2026";
const COMPANY_LEGAL_NAME = "M1.08 Browser Verification Limited";
const COMPANY_PHONE = "+923001234567";
const STAFF_PASSWORD = "M108BrowserStaff!2026";
const SANDBOX_KEY = "m1-08-browser-sandbox-key-2026";
const PDF_FIXTURE = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf8"
);

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
        reject(new Error("Could not allocate an M1.08 browser-test port."));
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

async function latestCompanyEmailCode(page, baseUrl) {
  await gotoOk(page, baseUrl, "/company/register/sandbox", "Company verification code");
  await page.getByLabel("Business email").fill(COMPANY_EMAIL);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest email code" }).click();
  const result = page.getByRole("status", { name: "Latest Company registration code" });
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await result.locator("strong").innerText()).trim();
  assert.match(code, /^\d{6}$/);
  return code;
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
  await bootstrapPage.getByLabel("First root email").fill("root.m108.browser@example.test");
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
    "root.m108.browser@example.test",
    "M1.08 Browser Root"
  );
  const rootSession = await loginStaff(browser, baseUrl, root);
  await gotoOk(rootSession.page, baseUrl, "/root/staff", "Create invitation");
  await rootSession.page.getByLabel("Staff email").fill("admin.m108.browser@example.test");
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
    "admin.m108.browser@example.test",
    "M1.08 Browser Admin"
  );
  return loginStaff(browser, baseUrl, admin);
}

async function runBrowserAcceptance(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const companyPage = await companyContext.newPage();
  const companyErrors = trackBrowserErrors(companyPage, "company");
  let adminSession = null;

  try {
    await gotoOk(companyPage, baseUrl, "/company/register", "Create a verified Company workspace.");
    await companyPage.getByLabel("Legal Company name").fill(COMPANY_LEGAL_NAME);
    await companyPage.getByLabel("Trading name").fill("M1.08 Browser Trading");
    await companyPage.getByLabel("Registration number").fill("M108-BROWSER-2026-001");
    await companyPage.getByLabel("Registration country").fill("Pakistan");
    await companyPage.getByLabel("Industry").fill("Industrial safety services");
    await companyPage.getByLabel("Company size").selectOption("11-50");
    await companyPage.getByLabel("Company website").fill("https://m108-browser.example.test");
    await companyPage.getByLabel("Authorized representative").fill("M1.08 Browser Owner");
    await companyPage.getByLabel("Business email").fill(COMPANY_EMAIL);
    await companyPage.getByLabel("Business phone").fill(COMPANY_PHONE);
    await companyPage.getByLabel("Create password").fill(COMPANY_PASSWORD);
    await companyPage.getByLabel("Confirm password").fill(COMPANY_PASSWORD);
    await companyPage.getByLabel("I accept the HSE Verify terms for this Company application.").check();
    await companyPage.getByLabel("I accept the privacy notice for Company verification data and evidence.").check();
    await companyPage.getByRole("button", { name: "Create Company application" }).click();
    await companyPage.waitForURL(/\/company\/register\/verify/, { timeout: 15_000 });

    const emailCode = await latestCompanyEmailCode(companyPage, baseUrl);
    await gotoOk(companyPage, baseUrl, "/company/register/verify", "Step 1 of 2");
    await companyPage.getByLabel("Email verification code").fill(emailCode);
    await companyPage.getByRole("button", { name: "Verify business email" }).click();
    await companyPage.getByText("Step 2 of 2", { exact: true }).waitFor({ timeout: 15_000 });
    const companySecret = (await companyPage.locator("code").innerText()).trim();
    assert(companySecret.length >= 16);
    await companyPage.getByLabel("Authenticator code").fill(totp(companySecret));
    await companyPage.getByRole("button", { name: "Activate Company account" }).click();
    await companyPage.waitForURL(/\/company\/login\?reason=registration-complete/, { timeout: 15_000 });
    await companyPage.getByLabel("Email address").fill(COMPANY_EMAIL);
    await companyPage.getByLabel("Password").fill(COMPANY_PASSWORD);
    await companyPage.getByLabel("Authenticator code").fill(totp(companySecret, 1));
    await companyPage.getByRole("button", { name: "Sign in" }).click();
    await companyPage.waitForURL(
      (url) => url.pathname.startsWith("/company/") && url.pathname !== "/company/login",
      { timeout: 15_000 }
    );

    await gotoOk(companyPage, baseUrl, "/company/settings/profile", "Company profile and verification");
    const verifiedEmail = companyPage.getByLabel("Verified business email");
    assert.equal(await verifiedEmail.inputValue(), COMPANY_EMAIL);
    assert.equal(await verifiedEmail.isDisabled(), true);

    const stalePage = await companyContext.newPage();
    const staleErrors = trackBrowserErrors(stalePage, "company-stale-tab");
    await gotoOk(stalePage, baseUrl, "/company/settings/profile", "Company profile and verification");
    await companyPage.getByLabel("Trading name").fill("M1.08 Browser Saved First");
    await companyPage.getByRole("button", { name: "Save Company details" }).click();
    await companyPage.getByText("Company details saved.", { exact: true }).waitFor({ timeout: 15_000 });
    await stalePage.getByLabel("Trading name").fill("M1.08 Stale Rewrite Attempt");
    await stalePage.getByRole("button", { name: "Save Company details" }).click();
    await stalePage.getByText(
      "The Company verification record changed before this request completed.",
      { exact: true }
    ).waitFor({ timeout: 15_000 });
    await stalePage.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await stalePage.getByLabel("Trading name").inputValue(), "M1.08 Browser Saved First");
    assert.equal(await stalePage.getByLabel("Verified business email").inputValue(), COMPANY_EMAIL);
    assert.deepEqual(staleErrors, []);
    await stalePage.close();

    await companyPage.getByLabel("Choose evidence file").setInputFiles({
      name: "m1-08-company-registration.pdf",
      mimeType: "application/pdf",
      buffer: PDF_FIXTURE
    });
    await companyPage.getByRole("button", { name: "Upload evidence" }).click();
    await companyPage.getByText(
      "Company evidence uploaded, security-scanned and attached to this verification version.",
      { exact: true }
    ).waitFor({ timeout: 15_000 });
    await companyPage.getByRole("button", { name: "Submit Company verification" }).click();
    await companyPage.getByRole("heading", { name: "Submitted", exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await companyPage.getByRole("button", { name: "Save Company details" }).count(), 0);

    adminSession = await bootstrapAdmin(browser, baseUrl);
    await gotoOk(adminSession.page, baseUrl, "/admin/company-verifications", "Company verification review");
    let card = adminSession.page.locator("article[data-case-id]").filter({ hasText: COMPANY_LEGAL_NAME }).first();
    await card.waitFor({ state: "visible", timeout: 15_000 });
    const previewHref = await card.getByRole("link", { name: "Preview evidence" }).getAttribute("href");
    assert(previewHref?.startsWith("/admin/company-verifications/"));
    const preview = await adminSession.context.request.get(`${baseUrl}${previewHref}`);
    assert.equal(preview.status(), 200);
    assert.match(preview.headers()["content-type"] ?? "", /application\/pdf/);
    assert.match(preview.headers()["content-disposition"] ?? "", /^inline;/);
    assert.equal((await preview.body()).subarray(0, 5).toString(), "%PDF-");

    await card.getByRole("button", { name: "Begin review" }).click();
    await adminSession.page.waitForURL(/result=review-started/, { timeout: 15_000 });
    card = adminSession.page.locator("article[data-case-id]").filter({ hasText: COMPANY_LEGAL_NAME }).first();
    await card.getByRole("button", { name: "Request changes" }).click();
    await adminSession.page.waitForURL(/result=decision-recorded/, { timeout: 15_000 });

    await companyPage.reload({ waitUntil: "domcontentloaded" });
    await companyPage.getByRole("heading", { name: "Changes requested", exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByRole("button", { name: "Create correction version" }).click();
    await companyPage.getByRole("heading", { name: "Draft", exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByText("Version 2", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await companyPage.getByLabel("Verified business email").inputValue(), COMPANY_EMAIL);
    await companyPage.getByLabel("Trading name").fill("M1.08 Browser Corrected Trading");
    await companyPage.getByRole("button", { name: "Save Company details" }).click();
    await companyPage.getByText("Company details saved.", { exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByLabel("Choose evidence file").setInputFiles({
      name: "m1-08-company-registration-corrected.pdf",
      mimeType: "application/pdf",
      buffer: PDF_FIXTURE
    });
    await companyPage.getByRole("button", { name: "Upload evidence" }).click();
    await companyPage.getByText(
      "Company evidence uploaded, security-scanned and attached to this verification version.",
      { exact: true }
    ).waitFor({ timeout: 15_000 });
    await companyPage.getByRole("button", { name: "Submit Company verification" }).click();
    await companyPage.getByRole("heading", { name: "Submitted", exact: true }).waitFor({ timeout: 15_000 });

    await gotoOk(adminSession.page, baseUrl, "/admin/company-verifications", "Company verification review");
    card = adminSession.page.locator("article[data-case-id]").filter({ hasText: COMPANY_LEGAL_NAME }).first();
    await card.getByText("version 2", { exact: false }).waitFor({ timeout: 15_000 });
    await card.getByRole("button", { name: "Begin review" }).click();
    await adminSession.page.waitForURL(/result=review-started/, { timeout: 15_000 });
    card = adminSession.page.locator("article[data-case-id]").filter({ hasText: COMPANY_LEGAL_NAME }).first();
    await card.getByRole("button", { name: "Verify Company" }).click();
    await adminSession.page.waitForURL(/result=decision-recorded/, { timeout: 15_000 });

    await companyPage.reload({ waitUntil: "domcontentloaded" });
    await companyPage.getByRole("heading", { name: "Verified", exact: true }).waitFor({ timeout: 15_000 });
    await companyPage.getByText(
      "Company verification is accepted and the tenant is active.",
      { exact: true }
    ).waitFor({ timeout: 15_000 });
    assert.equal(await companyPage.getByLabel("Verified business email").inputValue(), COMPANY_EMAIL);

    await companyPage.setViewportSize({ width: 390, height: 844 });
    const companyOverflow = await companyPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(companyOverflow <= 1, `Company verification page overflows mobile by ${companyOverflow}px`);
    await adminSession.page.setViewportSize({ width: 390, height: 844 });
    await gotoOk(adminSession.page, baseUrl, "/admin/company-verifications", "Company verification review");
    const adminOverflow = await adminSession.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(adminOverflow <= 1, `Admin verification page overflows mobile by ${adminOverflow}px`);

    assert.deepEqual(companyErrors, []);
    assert.deepEqual(adminSession.errors, []);
  } finally {
    await adminSession?.context.close();
    await companyContext.close();
    await browser.close();
  }
}

test("M1.08 real Chromium acceptance covers Company registration, correction, evidence review and activation", { timeout: 240_000 }, async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-m108-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "m1-08-browser-local",
    HSE_SESSION_SECRET: "m1-08-browser-session-secret-2026-000000000000",
    HSE_AUTH_PEPPER: "m1-08-browser-auth-pepper-2026-00000000000000",
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
      `M1.08 browser database migration failed.\n${migration.stdout ?? ""}\n${migration.stderr ?? ""}`
    );

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/company/register`,
      projectRoot,
      environment,
      probe: async ({ initialResponse }) => {
        assert.equal(initialResponse.status, 200);
        await runBrowserAcceptance(baseUrl);
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
