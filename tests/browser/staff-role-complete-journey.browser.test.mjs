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

const PASSWORD = "StaffJourney!2026";
const SANDBOX_KEY = "staff-role-browser-sandbox-key-2026";

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate browser-test port."));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function trackErrors(page, label) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`${label} console: ${message.text()}`); });
  return errors;
}

async function gotoOk(page, baseUrl, path, text) {
  const response = await page.goto(baseUrl + path, { waitUntil: "domcontentloaded" });
  assert(response && response.status() < 500, `${path} failed with ${response?.status()}`);
  if (text) await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
}

async function enroll(browser, baseUrl, invitationPath, role, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = trackErrors(page, role + "-enrollment");
  await gotoOk(page, baseUrl, invitationPath, "Create account credentials");
  await page.getByLabel("Full name").fill(`Journey ${role}`);
  await page.getByLabel("Create password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue to authenticator setup" }).click();
  const secret = (await page.locator(".security-key-card strong").innerText()).trim();
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Activate MFA and finish enrollment" }).click();
  await page.getByText("Enrollment complete", { exact: false }).waitFor({ timeout: 15_000 });
  assert.deepEqual(errors, []);
  await context.close();
  return { role, email, secret };
}

async function login(browser, baseUrl, identity) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = trackErrors(page, identity.role + "-login");
  await gotoOk(page, baseUrl, `/${identity.role}/login`, "sign in");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Authenticator code").fill(totp(identity.secret, 1));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === `/${identity.role}/dashboard`, { timeout: 15_000 });
  await page.getByText(`Welcome, Journey ${identity.role}`, { exact: false }).waitFor({ timeout: 15_000 });
  return { context, page, errors };
}

async function assertNoMobileOverflow(page, label) {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `${label} overflows mobile by ${overflow}px`);
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function runJourney(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const sessions = [];
  try {
    const bootstrap = await browser.newPage();
    await gotoOk(bootstrap, baseUrl, "/auth/sandbox/bootstrap-root", "Create the one-time invitation");
    await bootstrap.getByLabel("First root email").fill("root.staff.journey@example.test");
    await bootstrap.getByLabel("Authentication sandbox access key").fill(SANDBOX_KEY);
    await bootstrap.getByRole("button", { name: "Create first root invitation" }).click();
    const rootInvitation = (await bootstrap.locator(".security-key-card strong").innerText()).trim();
    await bootstrap.close();

    const rootIdentity = await enroll(browser, baseUrl, rootInvitation, "root", "root.staff.journey@example.test");
    const root = await login(browser, baseUrl, rootIdentity);
    sessions.push(root);
    await gotoOk(root.page, baseUrl, "/root/staff", "Create invitation");

    const identities = [];
    let previousInvitation = "";
    for (const role of ["admin", "verifier", "assessor"]) {
      const email = `${role}.staff.journey@example.test`;
      await root.page.getByLabel("Staff email").fill(email);
      await root.page.getByLabel("Portal role").selectOption(role);
      await root.page.getByRole("button", { name: "Create one-time invitation" }).click();
      const invitationLocator = root.page.locator(".security-key-card strong").first();
      await assert.doesNotReject(() => root.page.waitForFunction(
        ({ selector, previous }) => {
          const value = document.querySelector(selector)?.textContent?.trim() ?? "";
          return value.startsWith("/staff/invite/") && value !== previous;
        },
        { selector: ".security-key-card strong", previous: previousInvitation },
        { timeout: 15_000 }
      ));
      const invitation = (await invitationLocator.innerText()).trim();
      previousInvitation = invitation;
      identities.push(await enroll(browser, baseUrl, invitation, role, email));
    }
    await root.page.reload({ waitUntil: "domcontentloaded" });
    for (const identity of identities) {
      await root.page.getByText(identity.email, { exact: true }).waitFor({ timeout: 15_000 });
    }
    await assertNoMobileOverflow(root.page, "Root staff page");

    const expected = {
      admin: [["/admin/frameworks", "Frameworks & effective policy"], ["/admin/question-bank", "Question Bank"], ["/admin/assessment-blueprints", "Assessment blueprints"], ["/admin/assessment-catalogue", "Assessment catalogue"], ["/admin/decisions", "Decision Engine"], ["/admin/certifications", "Certification records"]],
      verifier: [["/verifier/reviews", "Evidence review queue"], ["/verifier/reviews/scoring", "Written scoring review"]],
      assessor: [["/assessor/interviews", "Interview assignments"]]
    };

    for (const identity of identities) {
      const session = await login(browser, baseUrl, identity);
      sessions.push(session);
      for (const [path, heading] of expected[identity.role]) {
        await gotoOk(session.page, baseUrl, path, heading);
        await assertNoMobileOverflow(session.page, path);
      }
      await gotoOk(session.page, baseUrl, "/account/sessions", "Active sessions");
      await assertNoMobileOverflow(session.page, identity.role + " sessions");
      const forbiddenRole = identity.role === "admin" ? "root" : "admin";
      await gotoOk(session.page, baseUrl, `/${forbiddenRole}/dashboard`, null);
      assert.match(session.page.url(), /\/access-denied$|\/(root|admin)\/login/, `${identity.role} crossed into ${forbiddenRole}`);
      assert.deepEqual(session.errors, []);
    }
    assert.deepEqual(root.errors, []);
  } finally {
    await Promise.all(sessions.map((session) => session.context.close().catch(() => {})));
    await browser.close();
  }
}

test("Root provisions every staff role and each MFA session reaches only its real workspaces", { timeout: 300_000 }, async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-staff-role-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "staff-role-browser-local",
    HSE_SESSION_SECRET: "staff-role-browser-session-secret-2026-000000000",
    HSE_AUTH_PEPPER: "staff-role-browser-auth-pepper-2026-00000000000",
    HSE_ENABLE_AUTH_SANDBOX: "true",
    HSE_AUTH_SANDBOX_ACCESS_KEY: SANDBOX_KEY,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };
  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], { cwd: projectRoot, env: environment, encoding: "utf8" });
    assert.equal(migration.status, 0, `Migration failed.\n${migration.stdout}\n${migration.stderr}`);
    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/root/login",
      projectRoot,
      environment,
      probe: async ({ initialResponse, output }) => {
        assert.equal(initialResponse.status, 200);
        try { await runJourney(baseUrl); } catch (error) { console.error(output()); throw error; }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
