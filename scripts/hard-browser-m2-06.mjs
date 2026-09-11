import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3003";
const SANDBOX_KEY = process.env.HSE_AUTH_SANDBOX_ACCESS_KEY;
const PASSWORD = "M206Browser!StrongPassword2026";
const artifactsDir = "artifacts/m2-06-browser";
const results = [];

if (!SANDBOX_KEY) throw new Error("HSE_AUTH_SANDBOX_ACCESS_KEY is required.");
await mkdir(artifactsDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

function totp(secret, offsetSeconds = 0) {
  const counter = Math.floor((Date.now() / 1000 + offsetSeconds) / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

async function checkpoint(name, operation) {
  const started = Date.now();
  try {
    const detail = await operation();
    results.push({ name, status: "PASS", ms: Date.now() - started, detail: detail ?? null });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, status: "FAIL", ms: Date.now() - started, error: message });
    console.error(`FAIL ${name}: ${message}`);
    throw error;
  }
}

async function goto200(page, path) {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  assert(response, `${path} returned no response`);
  assert(response.status() === 200, `${path} returned HTTP ${response.status()}`);
  return response;
}

async function bootstrapRoot(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await goto200(page, "/auth/sandbox/bootstrap-root");
  await page.getByLabel("First root email").fill("root.m206.browser@example.test");
  await page.getByLabel("Authentication sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Create first root invitation" }).click();
  const output = page.locator(".security-key-card strong");
  await output.waitFor({ state: "visible", timeout: 15_000 });
  const invitationPath = (await output.innerText()).trim();
  assert(invitationPath.startsWith("/staff/invite/"), "Root invitation path was not produced.");
  await context.close();
  return invitationPath;
}

async function enrollStaff(browser, invitationPath, role, email, displayName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const response = await page.goto(`${BASE_URL}${invitationPath}`, { waitUntil: "domcontentloaded" });
  assert(response && response.status() < 500, `${role} invitation failed.`);
  await page.waitForURL(/\/staff\/invite\/accept(?:\?|$)/, { timeout: 15_000 });
  await page.getByText("Create account credentials", { exact: false }).waitFor({ timeout: 15_000 });
  await page.getByLabel("Full name").fill(displayName);
  await page.getByLabel("Create password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue to authenticator setup" }).click();
  await page.getByText("Add HSE Verify to an authenticator app", { exact: false }).waitFor({ timeout: 15_000 });
  const secret = (await page.locator(".security-key-card strong").innerText()).trim();
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Activate MFA and finish enrollment" }).click();
  await page.getByText("Enrollment complete", { exact: false }).waitFor({ timeout: 15_000 });
  await context.close();
  return { email, secret };
}

async function loginStaff(browser, role, credentials) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await goto200(page, `/${role}/login`);
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Authenticator code").fill(totp(credentials.secret, 30));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(
    (url) => url.origin === BASE_URL && !url.pathname.includes("/login"),
    { timeout: 15_000 }
  );
  return { context, page };
}

async function inviteAdmin(rootPage) {
  await goto200(rootPage, "/root/staff");
  await rootPage.getByLabel("Staff email").fill("admin.m206.browser@example.test");
  await rootPage.getByLabel("Portal role").selectOption("admin");
  await rootPage.getByRole("button", { name: "Create one-time invitation" }).click();
  const output = rootPage.locator(".security-key-card strong");
  await output.waitFor({ state: "visible", timeout: 15_000 });
  const invitationPath = (await output.innerText()).trim();
  assert(invitationPath.startsWith("/staff/invite/"), "Admin invitation path was not produced.");
  return invitationPath;
}

async function latestSandboxCode(page, channel, destination) {
  await goto200(page, "/worker/register/sandbox");
  await page.getByLabel("Delivery channel").selectOption(channel);
  await page.getByLabel("Delivery destination").fill(destination);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest sandbox delivery" }).click();
  const result = page.getByRole("status", { name: "Latest sandbox verification code" });
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await result.locator("strong").innerText()).trim();
  assert(/^\d{6}$/.test(code), `Sandbox ${channel} code was not six digits.`);
  return code;
}

async function registerWorker(browser) {
  const email = "worker.m206.browser@example.test";
  const phone = "+923001234206";
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await goto200(page, "/worker/register");
  await page.getByLabel("Full name").fill("M2.06 Worker Browser");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Mobile phone").fill(phone);
  await page.getByLabel("Create password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create Worker account" }).click();
  await page.waitForURL(/\/worker\/register\/verify/, { timeout: 15_000 });

  const emailCode = await latestSandboxCode(page, "email", email);
  await goto200(page, "/worker/register/verify");
  await page.getByLabel("Verification code").fill(emailCode);
  await page.getByRole("button", { name: "Verify email" }).click();
  await page.getByText("Step 2 of 2", { exact: false }).waitFor({ timeout: 15_000 });

  const phoneCode = await latestSandboxCode(page, "phone", phone);
  await goto200(page, "/worker/register/verify");
  await page.getByLabel("Verification code").fill(phoneCode);
  await page.getByRole("button", { name: "Verify phone" }).click();
  await page.getByText("Activation complete", { exact: false }).waitFor({ timeout: 15_000 });

  await page.getByRole("link", { name: "Worker sign-in", exact: true }).click();
  await page.waitForURL(/\/worker\/login/, { timeout: 15_000 });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(
    (url) => url.origin === BASE_URL && url.pathname.startsWith("/worker/") && !url.pathname.includes("/login"),
    { timeout: 15_000 }
  );
  return { context, page };
}

const browser = await chromium.launch({ headless: true });
try {
  let adminCredentials;
  await checkpoint("provision real M2.06 Admin through Root invitation flow", async () => {
    const rootInvitation = await bootstrapRoot(browser);
    const rootCredentials = await enrollStaff(
      browser,
      rootInvitation,
      "root",
      "root.m206.browser@example.test",
      "M2.06 Root Browser"
    );
    const root = await loginStaff(browser, "root", rootCredentials);
    const adminInvitation = await inviteAdmin(root.page);
    await root.context.close();
    adminCredentials = await enrollStaff(
      browser,
      adminInvitation,
      "admin",
      "admin.m206.browser@example.test",
      "M2.06 Admin Browser"
    );
  });

  const admin = await loginStaff(browser, "admin", adminCredentials);
  try {
    await checkpoint("create M2.06 framework and exact active blueprint prerequisite", async () => {
      await goto200(admin.page, "/admin/frameworks");
      await admin.page.getByLabel("Reference", { exact: true }).fill("M206-BROWSER");
      await admin.page.getByLabel("Title", { exact: true }).first().fill("M2.06 Browser Framework");
      await admin.page.getByRole("button", { name: "Create framework" }).click();
      await admin.page.getByText("M206-BROWSER", { exact: false }).first().waitFor({ timeout: 15_000 });

      await goto200(admin.page, "/admin/assessment-blueprints");
      await admin.page.getByLabel("Blueprint reference").fill("BP-M206-BROWSER");
      await admin.page.getByLabel("Blueprint title").fill("M2.06 Browser Blueprint");
      await admin.page.getByLabel("Framework reference").fill("M206-BROWSER");
      await admin.page.getByLabel("Selector JSON").fill(
        JSON.stringify([{ count: 1, questionType: "MULTIPLE_CHOICE", tagsAll: ["core"] }])
      );
      await admin.page.getByRole("button", { name: "Create blueprint" }).click();
      await admin.page.getByText("BP-M206-BROWSER", { exact: true }).waitFor({ timeout: 15_000 });
    });

    await checkpoint("M2.06 Admin Assessment Catalogue create revise status workflow", async () => {
      const blueprintCard = admin.page.locator("article").filter({ hasText: "BP-M206-BROWSER" }).first();
      const codeValues = await blueprintCard.locator("code").allInnerTexts();
      const blueprintVersionId = codeValues.map((value) => value.trim()).find((value) => /^blueprint_version_[A-Za-z0-9_-]{24}$/.test(value));
      assert(blueprintVersionId, "Exact blueprint version ID was not visible in Admin blueprint UI.");

      const catalogueNav = admin.page.getByRole("link", { name: "Assessment catalogue" }).first();
      await catalogueNav.waitFor({ state: "visible", timeout: 15_000 });
      await catalogueNav.click();
      await admin.page.waitForURL(
        (url) => url.origin === BASE_URL && url.pathname === "/admin/assessment-catalogue",
        { timeout: 15_000 }
      );
      await admin.page.getByRole("heading", { name: "Assessment catalogue" }).waitFor({ timeout: 15_000 });
      await admin.page.getByLabel("Catalogue reference").fill("CAT-M206-BROWSER");
      await admin.page.getByLabel("Catalogue title").fill("M2.06 Browser Catalogue");
      await admin.page.getByLabel("Description").fill("Visible catalogue lifecycle proof");
      await admin.page.getByLabel("Framework reference").fill("M206-BROWSER");
      await admin.page.getByLabel("Blueprint version ID").fill(blueprintVersionId);
      await admin.page.getByLabel("Minimum verified qualifications").fill("0");
      await admin.page.getByRole("button", { name: "Create catalogue entry" }).click();
      await admin.page.getByText("CAT-M206-BROWSER", { exact: true }).waitFor({ timeout: 15_000 });
      await admin.page.getByText("Version 1 · ACTIVE", { exact: true }).waitFor({ timeout: 15_000 });

      await admin.page.reload({ waitUntil: "domcontentloaded" });
      await admin.page.getByText("CAT-M206-BROWSER", { exact: true }).waitFor({ timeout: 15_000 });
      await admin.page.getByText("Create a new immutable catalogue revision", { exact: true }).click();
      await admin.page.getByLabel("Revision title").fill("M2.06 Browser Catalogue Revised");
      await admin.page.getByLabel("Revision description").fill("Immutable catalogue revision proof");
      await admin.page.getByLabel("Revision framework reference").fill("M206-BROWSER");
      await admin.page.getByLabel("Revision blueprint version ID").fill(blueprintVersionId);
      await admin.page.getByLabel("Revision minimum verified qualifications").fill("0");
      await admin.page.getByRole("button", { name: "Publish revision" }).click();
      await admin.page.getByText("Version 2 · ACTIVE", { exact: true }).waitFor({ timeout: 15_000 });

      await admin.page.getByRole("button", { name: "Deactivate" }).click();
      await admin.page.getByRole("button", { name: "Reactivate" }).waitFor({ timeout: 15_000 });
      await admin.page.reload({ waitUntil: "domcontentloaded" });
      await admin.page.getByRole("button", { name: "Reactivate" }).waitFor({ timeout: 15_000 });
      await admin.page.getByRole("button", { name: "Reactivate" }).click();
      await admin.page.getByRole("button", { name: "Deactivate" }).waitFor({ timeout: 15_000 });
      await admin.page.screenshot({ path: `${artifactsDir}/admin-assessment-catalogue.png`, fullPage: true });
    });
  } finally {
    await admin.context.close();
  }

  const worker = await registerWorker(browser);
  try {
    await checkpoint("M2.06 Worker available assessments remain read-only across refresh", async () => {
      const nav = worker.page.getByRole("link", { name: "Available assessments" }).first();
      await nav.waitFor({ state: "visible", timeout: 15_000 });
      await nav.click();
      await worker.page.waitForURL(
        (url) => url.origin === BASE_URL && url.pathname === "/worker/available-assessments",
        { timeout: 15_000 }
      );
      await worker.page.getByRole("heading", { name: "Available assessments" }).waitFor({ timeout: 15_000 });
      await worker.page.getByText("No assessments are currently available.", { exact: true }).waitFor({ timeout: 15_000 });
      assert((await worker.page.locator("main button").count()) === 0, "Read-only Worker availability rendered an unexpected action button.");

      await worker.page.reload({ waitUntil: "domcontentloaded" });
      await worker.page.getByRole("heading", { name: "Available assessments" }).waitFor({ timeout: 15_000 });
      await worker.page.getByText("No assessments are currently available.", { exact: true }).waitFor({ timeout: 15_000 });
      assert((await worker.page.locator("main button").count()) === 0, "Read-only Worker availability changed after refresh.");
      await worker.page.screenshot({ path: `${artifactsDir}/worker-available-assessments.png`, fullPage: true });
    });
  } finally {
    await worker.context.close();
  }
} finally {
  await writeFile(`${artifactsDir}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
