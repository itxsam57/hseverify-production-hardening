import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const BASE_URL = process.env.HSE_BROWSER_BASE_URL || "http://127.0.0.1:3000";
const SANDBOX_KEY = process.env.HSE_AUTH_SANDBOX_ACCESS_KEY;
const STAFF_PASSWORD = "MixedRoleStaffQA!2026";
const WORKER_PASSWORD = "MixedRoleWorkerQA!2026";
const COMPANY_PASSWORD = "MixedRoleCompanyQA!2026";
const ARTIFACT_DIR = "artifacts/phase1-retrospective";
const REQUESTS_PER_ROLE = 10;

if (!SANDBOX_KEY) throw new Error("HSE_AUTH_SANDBOX_ACCESS_KEY is required.");
await mkdir(ARTIFACT_DIR, { recursive: true });

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

function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

function trackErrors(page, label, errors) {
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} console: ${message.text()}`);
  });
}

async function gotoOk(page, path, expectedText) {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  assert(response, `${path} returned no response`);
  assert(response.status() < 500, `${path} returned HTTP ${response.status()}`);
  if (expectedText) {
    await page.getByText(expectedText, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
  }
  return response;
}

async function enrollStaff(browser, invitationPath, { role, email, displayName }, errors) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  trackErrors(page, `${role}-enrollment`, errors);
  const response = await page.goto(`${BASE_URL}${invitationPath}`, { waitUntil: "domcontentloaded" });
  assert(response && response.status() < 500, `${role} invitation could not be opened`);
  await page.waitForURL(/\/staff\/invite\/accept(?:\?|$)/, { timeout: 15_000 });
  await page.getByText("Create account credentials", { exact: false }).waitFor({ timeout: 15_000 });
  await page.getByLabel("Full name").fill(displayName);
  await page.getByLabel("Create password").fill(STAFF_PASSWORD);
  await page.getByLabel("Confirm password").fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: "Continue to authenticator setup" }).click();
  await page.getByText("Add HSE Verify to an authenticator app", { exact: false }).waitFor({ timeout: 15_000 });
  const secret = (await page.locator(".security-key-card strong").innerText()).trim();
  assert(secret.length >= 16, `${role} authenticator secret was not shown`);
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Activate MFA and finish enrollment" }).click();
  await page.getByText("Enrollment complete", { exact: false }).waitFor({ timeout: 15_000 });
  await context.close();
  return { role, email, secret };
}

async function loginStaff(browser, identity, errors) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  trackErrors(page, `${identity.role}-login`, errors);
  await gotoOk(page, `/${identity.role}/login`, "sign in");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(STAFF_PASSWORD);
  await page.getByLabel("Authenticator code").fill(totp(identity.secret, 1));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith(`/${identity.role}/`) && url.pathname !== `/${identity.role}/login`,
    { timeout: 15_000 }
  );
  return { role: identity.role, context, page };
}

async function inviteStaff(rootPage, role, email) {
  await gotoOk(rootPage, "/root/staff", "Create invitation");
  const result = rootPage.locator(".security-key-card strong").first();
  const previous = (await result.count()) > 0 ? (await result.innerText()).trim() : null;
  await rootPage.getByLabel("Staff email").fill(email);
  await rootPage.getByLabel("Portal role").selectOption(role);
  await rootPage.getByRole("button", { name: "Create one-time invitation" }).click();
  await result.waitFor({ state: "visible", timeout: 15_000 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const invitationPath = (await result.innerText()).trim();
    if (invitationPath.startsWith("/staff/invite/") && invitationPath !== previous) return invitationPath;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${role} invitation path did not refresh`);
}

async function provisionStaff(browser, errors) {
  const bootstrapContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const bootstrapPage = await bootstrapContext.newPage();
  trackErrors(bootstrapPage, "root-bootstrap", errors);
  await gotoOk(bootstrapPage, "/auth/sandbox/bootstrap-root", "Create the one-time invitation");
  await bootstrapPage.getByLabel("First root email").fill("root.mixed.burst@example.test");
  await bootstrapPage.getByLabel("Authentication sandbox access key").fill(SANDBOX_KEY);
  await bootstrapPage.getByRole("button", { name: "Create first root invitation" }).click();
  const rootInvitation = (await bootstrapPage.locator(".security-key-card strong").innerText()).trim();
  assert(rootInvitation.startsWith("/staff/invite/"), "Root bootstrap did not produce an invitation path");
  await bootstrapContext.close();

  const rootIdentity = await enrollStaff(browser, rootInvitation, {
    role: "root",
    email: "root.mixed.burst@example.test",
    displayName: "Mixed Role Root QA"
  }, errors);
  const rootSession = await loginStaff(browser, rootIdentity, errors);

  const adminInvitation = await inviteStaff(rootSession.page, "admin", "admin.mixed.burst@example.test");
  const verifierInvitation = await inviteStaff(rootSession.page, "verifier", "verifier.mixed.burst@example.test");
  const adminIdentity = await enrollStaff(browser, adminInvitation, {
    role: "admin",
    email: "admin.mixed.burst@example.test",
    displayName: "Mixed Role Admin QA"
  }, errors);
  const verifierIdentity = await enrollStaff(browser, verifierInvitation, {
    role: "verifier",
    email: "verifier.mixed.burst@example.test",
    displayName: "Mixed Role Verifier QA"
  }, errors);

  return {
    root: rootSession,
    admin: await loginStaff(browser, adminIdentity, errors),
    verifier: await loginStaff(browser, verifierIdentity, errors)
  };
}

async function latestWorkerCode(page, channel, destination) {
  await gotoOk(page, "/worker/register/sandbox", "Sandbox inbox");
  await page.getByLabel("Delivery channel").selectOption(channel);
  await page.getByLabel("Delivery destination").fill(destination);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest sandbox delivery" }).click();
  const result = page.getByRole("status", { name: "Latest sandbox verification code" });
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await result.locator("strong").innerText()).trim();
  assert(/^\d{6}$/.test(code), `${channel} Worker OTP was not six digits`);
  return code;
}

async function registerWorker(browser, errors) {
  const email = "worker.mixed.burst@example.test";
  const phone = "+923001221133";
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  trackErrors(page, "worker", errors);
  await gotoOk(page, "/worker/register", "Create your Worker account");
  await page.getByLabel("Full name").fill("Mixed Role Worker QA");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Mobile phone").fill(phone);
  await page.getByLabel("Create password").fill(WORKER_PASSWORD);
  await page.getByLabel("Confirm password").fill(WORKER_PASSWORD);
  await page.getByRole("button", { name: "Create Worker account" }).click();
  await page.waitForURL(/\/worker\/register\/verify/, { timeout: 15_000 });

  const emailCode = await latestWorkerCode(page, "email", email);
  await gotoOk(page, "/worker/register/verify", "Step 1 of 2");
  await page.getByLabel("Verification code").fill(emailCode);
  await page.getByRole("button", { name: "Verify email" }).click();
  await page.getByText("Step 2 of 2", { exact: false }).waitFor({ timeout: 15_000 });

  const phoneCode = await latestWorkerCode(page, "phone", phone);
  await gotoOk(page, "/worker/register/verify", "Step 2 of 2");
  await page.getByLabel("Verification code").fill(phoneCode);
  await page.getByRole("button", { name: "Verify phone" }).click();
  await page.getByText("Activation complete", { exact: false }).waitFor({ timeout: 15_000 });

  await gotoOk(page, "/worker/login", "Worker sign in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(WORKER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/worker/") && url.pathname !== "/worker/login", { timeout: 15_000 });
  return { role: "worker", context, page };
}

async function latestCompanyCode(page, email) {
  await gotoOk(page, "/company/register/sandbox", "Company verification code");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest email code" }).click();
  const result = page.getByRole("status", { name: "Latest Company registration code" });
  await result.waitFor({ state: "visible", timeout: 15_000 });
  const code = (await result.locator("strong").innerText()).trim();
  assert(/^\d{6}$/.test(code), "Company email OTP was not six digits");
  return code;
}

async function registerCompany(browser, errors) {
  const email = "company.mixed.burst@example.test";
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  trackErrors(page, "company", errors);
  await gotoOk(page, "/company/register", "Create a verified Company workspace.");
  await page.getByLabel("Legal Company name").fill("Mixed Role Browser Services Limited");
  await page.getByLabel("Trading name").fill("Mixed Role Browser Services");
  await page.getByLabel("Registration number").fill("MIXED-BURST-2026-001");
  await page.getByLabel("Registration country").fill("Pakistan");
  await page.getByLabel("Industry").fill("Industrial safety services");
  await page.getByLabel("Company size").selectOption("11-50");
  await page.getByLabel("Company website").fill("https://mixed-burst.example.test");
  await page.getByLabel("Authorized representative").fill("Mixed Role Company QA");
  await page.getByLabel("Business email").fill(email);
  await page.getByLabel("Business phone").fill("+923001224455");
  await page.getByLabel("Create password").fill(COMPANY_PASSWORD);
  await page.getByLabel("Confirm password").fill(COMPANY_PASSWORD);
  await page.getByLabel("I accept the HSE Verify terms for this Company application.").check();
  await page.getByLabel("I accept the privacy notice for Company verification data and evidence.").check();
  await page.getByRole("button", { name: "Create Company application" }).click();
  await page.waitForURL(/\/company\/register\/verify/, { timeout: 15_000 });

  const emailCode = await latestCompanyCode(page, email);
  await gotoOk(page, "/company/register/verify", "Step 1 of 2");
  await page.getByLabel("Email verification code").fill(emailCode);
  await page.getByRole("button", { name: "Verify business email" }).click();
  await page.getByText("Step 2 of 2", { exact: true }).waitFor({ timeout: 15_000 });
  const setupKey = (await page.locator("code").innerText()).trim();
  assert(setupKey.length >= 16, "Company authenticator setup key was not shown");
  await page.getByLabel("Authenticator code").fill(totp(setupKey));
  await page.getByRole("button", { name: "Activate Company account" }).click();
  await page.waitForURL(/\/company\/login\?reason=registration-complete/, { timeout: 15_000 });

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(COMPANY_PASSWORD);
  await page.getByLabel("Authenticator code").fill(totp(setupKey, 1));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/company/") && url.pathname !== "/company/login", { timeout: 15_000 });
  return { role: "company", context, page };
}

async function runBurst(sessions) {
  const targets = [
    { role: "worker", session: sessions.worker, path: "/worker/dashboard", marker: "Permanent Worker ID" },
    { role: "company", session: sessions.company, path: "/company/dashboard", marker: "Company Portal" },
    { role: "verifier", session: sessions.verifier, path: "/verifier/dashboard", marker: "Verifier Portal" },
    { role: "admin", session: sessions.admin, path: "/admin/dashboard", marker: "Administrator Portal" },
    { role: "root", session: sessions.root, path: "/root/dashboard", marker: "Root administrator Portal" }
  ];

  const started = performance.now();
  const requests = targets.flatMap((target) =>
    Array.from({ length: REQUESTS_PER_ROLE }, (_, requestIndex) =>
      (async () => {
        const response = await target.session.context.request.get(`${BASE_URL}${target.path}`);
        const finalPath = new URL(response.url()).pathname;
        const body = await response.text();
        assert(response.status() === 200, `${target.role} request ${requestIndex + 1} returned HTTP ${response.status()}`);
        assert(finalPath === target.path, `${target.role} request ${requestIndex + 1} redirected to ${finalPath}`);
        assert(body.includes(target.marker), `${target.role} request ${requestIndex + 1} lost its role-specific protected projection`);
        return { role: target.role, status: response.status(), finalPath };
      })()
    )
  );
  const responses = await Promise.all(requests);
  const elapsedMs = Math.round(performance.now() - started);
  assert(responses.length === 50, `Expected 50 authenticated reads, received ${responses.length}`);

  const perRole = Object.fromEntries(
    targets.map(({ role }) => [role, responses.filter((response) => response.role === role).length])
  );
  for (const [role, count] of Object.entries(perRole)) {
    assert(count === REQUESTS_PER_ROLE, `${role} contributed ${count} reads instead of ${REQUESTS_PER_ROLE}`);
  }
  return { elapsedMs, requests: responses.length, perRole };
}

const browser = await chromium.launch({ headless: true });
const errors = [];
const sessions = [];
try {
  const staff = await provisionStaff(browser, errors);
  const worker = await registerWorker(browser, errors);
  const company = await registerCompany(browser, errors);
  sessions.push(staff.root, staff.admin, staff.verifier, worker, company);

  const burst = await runBurst({
    root: staff.root,
    admin: staff.admin,
    verifier: staff.verifier,
    worker,
    company
  });
  assert(errors.length === 0, `Mixed-role provisioning/browser errors: ${errors.join(" | ")}`);

  const evidence = {
    status: "PASS",
    interpretation: "Authenticated real-server correctness-under-load evidence. Timing is diagnostic only and is not a production latency or Internet-scale throughput SLA.",
    requests: burst.requests,
    requestsPerRole: REQUESTS_PER_ROLE,
    roles: Object.keys(burst.perRole),
    perRole: burst.perRole,
    elapsedMs: burst.elapsedMs
  };
  await writeFile(`${ARTIFACT_DIR}/mixed-role-http-burst.json`, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`PASS 50-request authenticated mixed-role real-server burst in ${burst.elapsedMs}ms`);
} finally {
  for (const session of sessions) await session.context.close().catch(() => {});
  await browser.close();
}
