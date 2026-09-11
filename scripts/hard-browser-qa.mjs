import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3000";
const SANDBOX_KEY = process.env.HSE_AUTH_SANDBOX_ACCESS_KEY;
const PASSWORD = "BrowserQA!StrongPassword2026";
const artifactsDir = "artifacts/hard-browser";
const results = [];

if (!SANDBOX_KEY) throw new Error("HSE_AUTH_SANDBOX_ACCESS_KEY is required.");
await mkdir(artifactsDir, { recursive: true });

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
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
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

async function gotoOk(page, path, expectedText) {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  assert(response, `${path} returned no response`);
  assert(response.status() < 500, `${path} returned HTTP ${response.status()}`);
  if (expectedText) {
    await page.getByText(expectedText, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
  }
  return response.status();
}

async function enrollStaff(browser, invitationPath, { role, email, displayName }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  const invitationResponse = await page.goto(`${BASE_URL}${invitationPath}`, { waitUntil: "domcontentloaded" });
  assert(invitationResponse, `${role} invitation returned no response`);
  assert(invitationResponse.status() < 500, `${role} invitation returned HTTP ${invitationResponse.status()}`);
  await page.waitForURL(/\/staff\/invite\/accept(?:\?|$)/, { timeout: 15_000 });
  const bodyText = await page.locator("body").innerText();
  const cookieMetadata = (await context.cookies(BASE_URL)).map((cookie) => ({
    name: cookie.name,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite
  }));
  console.log(`STAFF_ENROLLMENT_REDIRECT ${JSON.stringify({ role, finalPath: new URL(page.url()).pathname, hasProfileStep: bodyText.includes("Create account credentials"), hasUnavailableState: bodyText.includes("Invitation unavailable"), cookies: cookieMetadata })}`);
  if (!bodyText.includes("Create account credentials")) {
    await page.screenshot({ path: `${artifactsDir}/${role}-enrollment-unavailable.png`, fullPage: true });
  }
  assert(bodyText.includes("Create account credentials"), `${role} invitation did not open the protected profile enrollment step`);

  await page.getByLabel("Full name").fill(displayName);
  await page.getByLabel("Create password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue to authenticator setup" }).click();
  await page.getByText("Add HSE Verify to an authenticator app", { exact: false }).waitFor({ timeout: 15_000 });
  const secret = (await page.locator(".security-key-card strong").innerText()).trim();
  assert(secret.length >= 16, `${role} TOTP secret was not shown`);
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Activate MFA and finish enrollment" }).click();
  await page.getByText("Enrollment complete", { exact: false }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${artifactsDir}/${role}-enrollment-complete.png`, fullPage: true });
  assert(errors.length === 0, `${role} enrollment browser errors: ${errors.join(" | ")}`);
  await context.close();
  return { secret, email };
}

async function loginStaff(browser, { role, email, secret }, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await gotoOk(page, `/${role}/login`, "sign in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Authenticator code").fill(totp(secret, 30));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith(`/${role}/`) && url.pathname !== `/${role}/login`,
    { timeout: 15_000 }
  );
  assert(!page.url().includes("/login"), `${role} remained on login after valid credentials`);
  return { context, page, errors };
}

async function inviteStaff(page, role, email) {
  await gotoOk(page, "/root/staff", "Create invitation");
  await page.getByLabel("Staff email").fill(email);
  await page.getByLabel("Portal role").selectOption(role);
  await page.getByRole("button", { name: "Create one-time invitation" }).click();
  const result = page.locator(".security-key-card strong");
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const invitationPath = (await result.innerText()).trim();
  assert(invitationPath.startsWith("/staff/invite/"), `${role} invitation path was not produced`);
  return invitationPath;
}

const browser = await chromium.launch({ headless: true });
let activePage = null;
try {
  await checkpoint("public routes render without server failures", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    activePage = page;
    const routes = [
      ["/", "HSE Verify"],
      ["/worker/login", "Worker sign in"],
      ["/company/login", "Company sign in"],
      ["/verifier/login", "Verifier sign in"],
      ["/admin/login", "Administrator sign in"],
      ["/worker/register", "Worker"],
      ["/company/register", "Company"],
      ["/auth/sandbox/bootstrap-root", "Bootstrap the first root account"]
    ];
    for (const [path, text] of routes) await gotoOk(page, path, text);
    await context.close();
    activePage = null;
  });

  let rootInvite;
  await checkpoint("zero-state Root bootstrap creates one-time invitation through UI", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    activePage = page;
    await gotoOk(page, "/auth/sandbox/bootstrap-root", "Create the one-time invitation");
    await page.getByLabel("First root email").fill("root.browser.qa@example.test");
    await page.getByLabel("Authentication sandbox access key").fill(SANDBOX_KEY);
    await page.getByRole("button", { name: "Create first root invitation" }).click();
    const result = page.locator(".security-key-card strong");
    await result.waitFor({ state: "visible", timeout: 15_000 });
    rootInvite = (await result.innerText()).trim();
    assert(rootInvite.startsWith("/staff/invite/"), "Root invitation path was not shown");
    await page.screenshot({ path: `${artifactsDir}/root-bootstrap.png`, fullPage: true });
    await context.close();
    activePage = null;
  });

  const root = await enrollStaff(browser, rootInvite, {
    role: "root",
    email: "root.browser.qa@example.test",
    displayName: "Root Browser QA"
  });

  let rootSession;
  await checkpoint("Root MFA login and portal isolation", async () => {
    rootSession = await loginStaff(browser, { role: "root", ...root });
    activePage = rootSession.page;
    await gotoOk(rootSession.page, "/admin/login", "isolated Root administrator Portal session is active");
    assert(!(await rootSession.page.getByLabel("Email address").count()), "Admin login form was exposed while Root session was active");
    await gotoOk(rootSession.page, "/root/staff", "Invitation-only portal accounts");
  });

  let adminInvite;
  let verifierInvite;
  await checkpoint("Root provisions Admin and Verifier through visible invitation UI", async () => {
    adminInvite = await inviteStaff(rootSession.page, "admin", "admin.browser.qa@example.test");
    verifierInvite = await inviteStaff(rootSession.page, "verifier", "verifier.browser.qa@example.test");
    assert(adminInvite !== verifierInvite, "Distinct staff invitations reused the same path");
  });

  const admin = await enrollStaff(browser, adminInvite, {
    role: "admin",
    email: "admin.browser.qa@example.test",
    displayName: "Admin Browser QA"
  });
  const verifier = await enrollStaff(browser, verifierInvite, {
    role: "verifier",
    email: "verifier.browser.qa@example.test",
    displayName: "Verifier Browser QA"
  });

  const adminSession = await loginStaff(browser, { role: "admin", ...admin });
  activePage = adminSession.page;

  await checkpoint("M1.05 notification bell unread deep link workflow", async () => {
  const page = adminSession.page;
  const errorBaseline = adminSession.errors.length;

  async function unreadCountFromBell() {
    const bell = page.locator("details.notification-menu > summary");
    await bell.waitFor({ state: "visible", timeout: 15_000 });
    const ariaLabel = await bell.getAttribute("aria-label");
    const match = /^(\d+) unread notifications$/.exec(ariaLabel ?? "");
    assert(match, `Notification bell did not expose an unread count: ${ariaLabel}`);
    return Number(match[1]);
  }

  await gotoOk(page, "/admin/dashboard");
  const unreadBefore = await unreadCountFromBell();

  await gotoOk(page, "/admin/notifications", "Notifications");
  await page.getByRole("button", { name: "Create persisted test notification" }).click();
  await page
    .getByText("The real outbox worker projected the test notification successfully.", { exact: false })
    .waitFor({ state: "visible", timeout: 15_000 });

  let notificationItem = page
    .locator("li.notification-center-item")
    .filter({ hasText: "Notification foundation ready" })
    .first();
  await notificationItem.waitFor({ state: "visible", timeout: 15_000 });
  await notificationItem.getByText("Unread", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

  const unreadAfterCreate = await unreadCountFromBell();
  assert(
    unreadAfterCreate === unreadBefore + 1,
    `Notification bell unread count did not increment: before=${unreadBefore}, after=${unreadAfterCreate}`
  );

  await notificationItem.getByRole("button", { name: "Open", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/admin/dashboard", { timeout: 15_000 });
  const unreadAfterOpen = await unreadCountFromBell();
  assert(
    unreadAfterOpen === unreadBefore,
    `Opening the notification did not restore unread count: expected=${unreadBefore}, actual=${unreadAfterOpen}`
  );

  await gotoOk(page, "/admin/notifications", "Notifications");
  notificationItem = page
    .locator("li.notification-center-item")
    .filter({ hasText: "Notification foundation ready" })
    .first();
  await notificationItem.waitFor({ state: "visible", timeout: 15_000 });
  await notificationItem.getByText("Read", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Notifications", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  notificationItem = page
    .locator("li.notification-center-item")
    .filter({ hasText: "Notification foundation ready" })
    .first();
  await notificationItem.getByText("Read", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  const unreadAfterReload = await unreadCountFromBell();
  assert(
    unreadAfterReload === unreadBefore,
    `Notification read state did not persist after reload: expected=${unreadBefore}, actual=${unreadAfterReload}`
  );

  await page.screenshot({
    path: `${artifactsDir}/m1-05-admin-notification-read.png`,
    fullPage: true,
    caret: "initial"
  });
  const newErrors = adminSession.errors.slice(errorBaseline);
  assert(newErrors.length === 0, `M1.05 notification browser errors: ${newErrors.join(" | ")}`);
  return { unreadBefore, unreadAfterCreate, unreadAfterOpen, unreadAfterReload };
});

  await checkpoint("M2.03 Admin creates framework and publishes immutable effective policy", async () => {
    const page = adminSession.page;
    await gotoOk(page, "/admin/frameworks", "Frameworks & effective policy");
    await page.getByLabel("Reference", { exact: true }).fill("HSE-CORE");
    await page.getByLabel("Title", { exact: true }).first().fill("HSE Core Browser QA");
    await page.getByRole("button", { name: "Create framework" }).click();
    await page.getByText("HSE-CORE", { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.getByLabel("Framework reference").fill("HSE-CORE");
    await page.getByLabel("Policy reference").fill("HSE-CORE-POLICY");
    await page.getByLabel("Title", { exact: true }).last().fill("HSE Core Policy Browser QA");
    await page.getByLabel("Effective from").fill(new Date(Date.now() - 60_000).toISOString().slice(0, 16));
    await page.getByLabel("Policy values JSON").fill('{"pass_mark":80,"max_attempts":2}');
    await page.getByLabel("Override allowed fields JSON").fill('["pass_mark","max_attempts"]');
    await page.getByLabel("Override directions JSON").fill('{"pass_mark":"MINIMUM","max_attempts":"MAXIMUM"}');
    await page.getByRole("button", { name: "Publish immutable version" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("HSE-CORE", { exact: false }).first().waitFor();
    await page.screenshot({ path: `${artifactsDir}/m2-03-frameworks.png`, fullPage: true });
  });

  await checkpoint("M2.04 Question Bank create, persistence and status toggle", async () => {
    const page = adminSession.page;
    await gotoOk(page, "/admin/question-bank", "Question Bank");
    await page.getByLabel("Stable reference").fill("QB-BROWSER-001");
    const payload = {
      questionType: "MULTIPLE_CHOICE",
      prompt: "What is the first safe action after discovering an uncontrolled workplace hazard?",
      options: ["Stop work", "Continue working", "Ignore the hazard"],
      answerKey: "Stop work",
      rubric: null,
      frameworkReference: "HSE-CORE",
      domainReference: "Hazard control",
      difficulty: "MEDIUM",
      tags: ["hazards", "browser-qa"]
    };
    await page.getByLabel("Version JSON").fill(JSON.stringify(payload, null, 2));
    await page.getByRole("button", { name: "Create active question" }).click();
    await page.getByText("QB-BROWSER-001", { exact: true }).waitFor({ timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("QB-BROWSER-001", { exact: true }).waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("button", { name: "Reactivate" }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: `${artifactsDir}/m2-04-question-bank.png`, fullPage: true });
  });

  await checkpoint("Admin role isolation denies Root and Verifier portal crossover", async () => {
    const page = adminSession.page;
    await gotoOk(page, "/root/login", "isolated Administrator Portal session is active");
    assert(!(await page.getByLabel("Email address").count()), "Root login form was exposed while Admin session was active");
    await gotoOk(page, "/verifier/login", "isolated Administrator Portal session is active");
    assert(!(await page.getByLabel("Email address").count()), "Verifier login form was exposed while Admin session was active");
  });

  await adminSession.context.close();
  activePage = null;

  const verifierSession = await loginStaff(browser, { role: "verifier", ...verifier });
  activePage = verifierSession.page;
  await checkpoint("M2.02 Verifier review queue renders and navigation is stable", async () => {
    const page = verifierSession.page;
    await page.getByRole("link", { name: "Open evidence review queue" }).click();
    await page.waitForURL((url) => url.pathname === "/verifier/reviews", { timeout: 15_000 });
    await page.getByRole("heading", { name: "Evidence review queue" }).waitFor({ timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    assert(!page.url().includes("/login"), "Verifier queue lost the session on refresh");
    await page.getByRole("heading", { name: "Evidence review queue" }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: `${artifactsDir}/m2-02-verifier-queue.png`, fullPage: true });
  });

  await checkpoint("Verifier mobile layout has no horizontal overflow", async () => {
    await verifierSession.page.setViewportSize({ width: 390, height: 844 });
    await gotoOk(verifierSession.page, "/verifier/reviews", "Evidence review queue");
    const overflow = await verifierSession.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 1, `Verifier queue horizontally overflows mobile viewport by ${overflow}px`);
    await verifierSession.page.screenshot({ path: `${artifactsDir}/mobile-verifier-queue.png`, fullPage: true });
  });
  assert(verifierSession.errors.length === 0, `Verifier browser errors: ${verifierSession.errors.join(" | ")}`);
  await verifierSession.context.close();
  activePage = null;

  assert(rootSession.errors.length === 0, `Root browser errors: ${rootSession.errors.join(" | ")}`);
  await rootSession.context.close();
  rootSession = null;

  console.log(`Hard browser QA passed ${results.length} checkpoints.`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${artifactsDir}/failure.png`, fullPage: true }).catch(() => undefined);
  }
  throw error;
} finally {
  await writeFile(`${artifactsDir}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
