import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const EMAIL = "otp.boundary.worker@example.test";
const PHONE = "+923008881209";
const SANDBOX_KEY = "otp-boundary-synthetic-sandbox-key-2026";
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
async function sandboxCode(page, baseUrl, channel, destination) {
  await page.goto(baseUrl + "/worker/register/sandbox");
  await page.getByLabel("Delivery channel").selectOption(channel);
  await page.getByLabel("Delivery destination").fill(destination);
  await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Open latest sandbox delivery" }).click();
  const status = page.getByRole("status", { name: "Latest sandbox verification code" });
  await status.waitFor();
  return (await status.locator("strong").innerText()).trim();
}
function wrongCode(code) { return String((Number(code) + 1) % 1000000).padStart(6, "0"); }
async function verify(page, code, channel, error) {
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify " + channel, exact: true }).click();
  if (error) await page.waitForURL("**/worker/register/verify?error=" + error);
}
test("Worker email and phone OTP reject wrong/expired codes, resend and activate only after both contacts", { timeout: 240000 }, async () => {
  const root = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "hse-worker-otp-boundaries-"));
  const port = await freePort(), baseUrl = "http://127.0.0.1:" + port;
  const environment = {
    ...process.env, HSE_APP_ENV: "development", HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: directory, HSE_RELEASE_SHA: "worker-otp-boundaries",
    HSE_SESSION_SECRET: "worker-otp-boundaries-session-secret-with-more-than-thirty-two",
    HSE_AUTH_PEPPER: "worker-otp-boundaries-auth-pepper-with-more-than-thirty-two",
    HSE_ENABLE_AUTH_SANDBOX: "true", HSE_AUTH_SANDBOX_ACCESS_KEY: SANDBOX_KEY,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false"
  };
  let browser;
  let emailCode, phoneCode, staleEmail, stalePhone;
  const errors = [];
  async function phase(probe) {
    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/worker/register", projectRoot: root, environment, probe
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  }
  async function snapshotAndExpire(expectedStatus, purpose) {
    // The server is stopped: alter only synthetic expiry/cooldown fixture dates.
    // Browser clock remains real and its already-rendered form submits to real guards.
    const db = new PGlite(directory);
    try {
      const account = (await db.query("SELECT * FROM auth_accounts WHERE email_normalized=$1", [EMAIL])).rows[0];
      assert.equal(account.account_status, expectedStatus);
      assert.equal(Boolean(account.email_verified_at), expectedStatus === "pending_phone");
      assert.equal(Boolean(account.phone_verified_at), false);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1", [account.account_id])).rows[0].count, 0);
      const active = (await db.query("SELECT challenge_id FROM auth_otp_challenges WHERE account_id=$1 AND purpose=$2 AND consumed_at IS NULL AND invalidated_at IS NULL", [account.account_id, purpose])).rows;
      assert.equal(active.length, 1);
      await db.query("UPDATE auth_otp_challenges SET created_at=CURRENT_TIMESTAMP-INTERVAL '20 minutes', expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute', resend_available_at=CURRENT_TIMESTAMP-INTERVAL '2 minutes' WHERE challenge_id=$1", [active[0].challenge_id]);
    } finally { await db.close(); }
  }
  try {
    const migrated = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], { cwd: root, env: environment, encoding: "utf8" });
    assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    let page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await phase(async () => {
      await page.goto(baseUrl + "/worker/register");
      await page.getByLabel("Full name").fill("OTP Boundary Worker");
      await page.getByLabel("Email address").fill(EMAIL);
      await page.getByLabel("Mobile phone").fill(PHONE);
      await page.getByLabel("Country", { exact: true }).fill("Pakistan");
      await page.getByLabel("Create password").fill("OtpBoundary!Password2026");
      await page.getByLabel("Confirm password").fill("OtpBoundary!Password2026");
      await page.getByLabel("I accept the HSE Verify terms for this Worker account.", { exact: true }).check();
      await page.getByLabel("I accept the privacy notice for Worker registration data.", { exact: true }).check();
      await page.getByRole("button", { name: "Create Worker account", exact: true }).click();
      await page.waitForURL("**/worker/register/verify");
      emailCode = await sandboxCode(page, baseUrl, "email", EMAIL);
      await page.goto(baseUrl + "/worker/register/verify");
      await verify(page, wrongCode(emailCode), "email", "invalid-code");
      assert.equal(await page.getByRole("button", { name: /Resend in/ }).isDisabled(), true);
      await page.getByText("Step 1 of 2: email", { exact: true }).waitFor();
      // Keep a genuinely old normal-POST form across dev-server restart.
      // A separate no-JavaScript context prevents development HMR refreshing it.
      const staleEmailContext = await browser.newContext({ storageState: await context.storageState(), javaScriptEnabled: false });
      staleEmail = await staleEmailContext.newPage();
      staleEmail.on("pageerror", error => errors.push(error.message));
      await staleEmail.goto(baseUrl + "/worker/register/verify");
    });
    await snapshotAndExpire("pending_email", "registration_email");
    await phase(async () => {
      // Preserve the pre-expiry normal POST; avoid HMR racing navigation on the restarted server.
      await page.close();
      page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await verify(staleEmail, emailCode, "email", "expired");
      await page.goto(baseUrl + "/worker/register/verify?error=expired");
      console.log("ACTUAL_CAPTURED_OTP_EXPIRY email captured pre-expiry normal POST rejected by backend; fresh live UI remains tested");
      await page.getByText("Expired. Request a new code.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Verify email", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "Send new code", exact: true }).click();
      await page.waitForURL("**/worker/register/verify?status=resent");
      await verify(staleEmail, emailCode, "email", "stale-code");
      await staleEmail.close();
      const newEmailCode = await sandboxCode(page, baseUrl, "email", EMAIL);
      await page.goto(baseUrl + "/worker/register/verify");
      await verify(page, newEmailCode, "email");
      await page.getByText("Step 2 of 2: phone", { exact: true }).waitFor();
      phoneCode = await sandboxCode(page, baseUrl, "phone", PHONE);
      await page.goto(baseUrl + "/worker/register/verify");
      await verify(page, wrongCode(phoneCode), "phone", "invalid-code");
      assert.equal(await page.getByRole("button", { name: /Resend in/ }).isDisabled(), true);
      await page.getByText("Step 2 of 2: phone", { exact: true }).waitFor();
      const stalePhoneContext = await browser.newContext({ storageState: await context.storageState(), javaScriptEnabled: false });
      stalePhone = await stalePhoneContext.newPage();
      stalePhone.on("pageerror", error => errors.push(error.message));
      await stalePhone.goto(baseUrl + "/worker/register/verify");
    });
    await snapshotAndExpire("pending_phone", "registration_phone");
    await phase(async () => {
      // Preserve the pre-expiry normal POST; avoid HMR racing navigation on the restarted server.
      await page.close();
      page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await verify(stalePhone, phoneCode, "phone", "expired");
      await page.goto(baseUrl + "/worker/register/verify?error=expired");
      console.log("ACTUAL_CAPTURED_OTP_EXPIRY phone captured pre-expiry normal POST rejected by backend; fresh live UI remains tested");
      await page.getByText("Expired. Request a new code.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Verify phone", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "Send new code", exact: true }).click();
      await page.waitForURL("**/worker/register/verify?status=resent");
      await verify(stalePhone, phoneCode, "phone", "stale-code");
      await stalePhone.close();
      const newPhoneCode = await sandboxCode(page, baseUrl, "phone", PHONE);
      await page.goto(baseUrl + "/worker/register/verify");
      await verify(page, newPhoneCode, "phone");
      await page.waitForURL("**/worker/register/verify?stage=complete");
    });
    assert.deepEqual(errors, []);
    const db = new PGlite(directory);
    try {
      const account = (await db.query("SELECT * FROM auth_accounts WHERE email_normalized=$1", [EMAIL])).rows[0];
      assert.equal(account.account_status, "active");
      assert.ok(account.email_verified_at);
      assert.ok(account.phone_verified_at);
      const flows = (await db.query("SELECT current_step,completed_at FROM auth_registration_flows WHERE account_id=$1", [account.account_id])).rows;
      assert.equal(flows.length, 1); assert.equal(flows[0].current_step, "complete"); assert.ok(flows[0].completed_at);
      const challenges = (await db.query("SELECT purpose,consumed_at,invalidated_at,attempts_remaining FROM auth_otp_challenges WHERE account_id=$1", [account.account_id])).rows;
      assert.equal(challenges.length, 4);
      for (const purpose of ["registration_email", "registration_phone"]) {
        const rows = challenges.filter(row => row.purpose === purpose);
        assert.equal(rows.length, 2);
        assert.equal(rows.filter(row => row.consumed_at && !row.invalidated_at).length, 1);
        assert.equal(rows.filter(row => row.invalidated_at && !row.consumed_at).length, 1);
        assert.equal(rows.find(row => row.invalidated_at).attempts_remaining, 4);
        assert.equal(rows.find(row => row.consumed_at).attempts_remaining, 5);
      }
      const events = (await db.query("SELECT event_type,count(*)::int AS count FROM auth_security_events WHERE account_id=$1 AND event_type IN ('otp_issued','otp_failed','otp_verified') GROUP BY event_type", [account.account_id])).rows;
      assert.deepEqual(Object.fromEntries(events.map(row => [row.event_type, row.count])), { otp_issued: 4, otp_failed: 2, otp_verified: 2 });
      assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1", [account.account_id])).rows[0].count, 0);
    } finally { await db.close(); }
  } finally {
    if (browser) await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
