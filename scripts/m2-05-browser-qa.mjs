import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3002";
const SANDBOX_KEY = process.env.HSE_AUTH_SANDBOX_ACCESS_KEY;
const PASSWORD = "M205Browser!StrongPassword2026";
const artifactsDir = "artifacts/m2-05-browser";
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
  await page.getByLabel("First root email").fill("root.m205.browser@example.test");
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
  await rootPage.getByLabel("Staff email").fill("admin.m205.browser@example.test");
  await rootPage.getByLabel("Portal role").selectOption("admin");
  await rootPage.getByRole("button", { name: "Create one-time invitation" }).click();
  const output = rootPage.locator(".security-key-card strong");
  await output.waitFor({ state: "visible", timeout: 15_000 });
  const invitationPath = (await output.innerText()).trim();
  assert(invitationPath.startsWith("/staff/invite/"), "Admin invitation path was not produced.");
  return invitationPath;
}

const browser = await chromium.launch({ headless: true });
try {
  let adminCredentials;
  await checkpoint("provision a real Admin through Root invitation flow", async () => {
    const rootInvitation = await bootstrapRoot(browser);
    const rootCredentials = await enrollStaff(
      browser,
      rootInvitation,
      "root",
      "root.m205.browser@example.test",
      "M2.05 Root Browser"
    );
    const root = await loginStaff(browser, "root", rootCredentials);
    const adminInvitation = await inviteAdmin(root.page);
    await root.context.close();
    adminCredentials = await enrollStaff(
      browser,
      adminInvitation,
      "admin",
      "admin.m205.browser@example.test",
      "M2.05 Admin Browser"
    );
  });

  const admin = await loginStaff(browser, "admin", adminCredentials);
  try {
    await checkpoint("create prerequisite framework through Admin UI", async () => {
      await goto200(admin.page, "/admin/frameworks");
      await admin.page.getByLabel("Reference", { exact: true }).fill("M205-BROWSER");
      await admin.page.getByLabel("Title", { exact: true }).first().fill("M2.05 Browser Framework");
      await admin.page.getByRole("button", { name: "Create framework" }).click();
      await admin.page.getByText("M205-BROWSER", { exact: false }).first().waitFor({ timeout: 15_000 });
    });

    await checkpoint("M2.05 Assessment Blueprint create revise status workflow", async () => {
      const blueprintNav = admin.page.getByRole("link", { name: "Assessment blueprints" });
      await blueprintNav.waitFor({ state: "visible", timeout: 15_000 });
      await blueprintNav.click();
      await admin.page.waitForURL(
        (url) => url.origin === BASE_URL && url.pathname === "/admin/assessment-blueprints",
        { timeout: 15_000 }
      );
      await admin.page.getByRole("heading", { name: "Assessment blueprints" }).waitFor({ timeout: 15_000 });
      await admin.page.getByLabel("Blueprint reference").fill("BP-M205-BROWSER");
      await admin.page.getByLabel("Blueprint title").fill("Browser safety assessment");
      await admin.page.getByLabel("Framework reference").fill("M205-BROWSER");
      await admin.page.getByLabel("Selector JSON").fill(
        JSON.stringify([
          {
            count: 2,
            questionType: "MULTIPLE_CHOICE",
            domainReference: "Hazard Control",
            difficulty: "MEDIUM",
            tagsAll: ["core"]
          }
        ])
      );
      await admin.page.getByRole("button", { name: "Create blueprint" }).click();
      await admin.page.getByText("BP-M205-BROWSER", { exact: true }).waitFor({ timeout: 15_000 });
      await admin.page.getByText("Version 1", { exact: false }).waitFor({ timeout: 15_000 });
      await admin.page.reload({ waitUntil: "domcontentloaded" });
      await admin.page.getByText("BP-M205-BROWSER", { exact: true }).waitFor({ timeout: 15_000 });

      await admin.page.getByText("Create a new immutable revision", { exact: true }).click();
      await admin.page.getByLabel("Revision title").fill("Browser safety assessment revised");
      await admin.page.getByLabel("Revision framework reference").fill("M205-BROWSER");
      await admin.page.getByLabel("Revision selector JSON").fill(
        JSON.stringify([{ count: 1, questionType: "MULTIPLE_CHOICE", tagsAll: ["core"] }])
      );
      await admin.page.getByRole("button", { name: "Publish revision" }).click();
      await admin.page.getByText("Version 2", { exact: false }).waitFor({ timeout: 15_000 });

      await admin.page.getByRole("button", { name: "Deactivate" }).click();
      await admin.page.getByRole("button", { name: "Reactivate" }).waitFor({ timeout: 15_000 });
      await admin.page.getByRole("button", { name: "Reactivate" }).click();
      await admin.page.getByRole("button", { name: "Deactivate" }).waitFor({ timeout: 15_000 });
      await admin.page.screenshot({ path: `${artifactsDir}/assessment-blueprints.png`, fullPage: true });
    });
  } finally {
    await admin.context.close();
  }
} finally {
  await writeFile(`${artifactsDir}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}