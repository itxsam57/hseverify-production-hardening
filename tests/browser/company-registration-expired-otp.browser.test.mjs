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

const SANDBOX_KEY = "company-expiry-qa-synthetic-access-only-2026";
const EMAIL = "company.expiry.boundary@example.test";

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

test("Real Company browser refuses expired email OTP and cross-origin resend, then allows only fresh resend", { timeout: 190_000 }, async () => {
  const root = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "hse-company-expired-otp-"));
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: directory,
    HSE_RELEASE_SHA: "m10302-company-otp-expiry-real-browser",
    HSE_SESSION_SECRET: "company-expiry-browser-session-secret-more-than-thirty-two",
    HSE_AUTH_PEPPER: "company-expiry-browser-pepper-secret-more-than-thirty-two",
    HSE_ENABLE_AUTH_SANDBOX: "true",
    HSE_AUTH_SANDBOX_ACCESS_KEY: SANDBOX_KEY,
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };
  let browser;
  const errors = [];
  const phase = async probe => {
    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/company/register",
      projectRoot: root,
      environment,
      probe
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  };
  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: root, env: environment, encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    let expiredCode, expiredId;

    await phase(async () => {
      await page.goto(baseUrl + "/company/register");
      for (const [label, value] of [
        ["Legal Company name", "Expired Boundary Safety Limited"],
        ["Trading name", "Expired Boundary Safety"],
        ["Registration number", "EXPIRED-OTP-COMPANY-2026"],
        ["Registration country", "Pakistan"],
        ["Industry", "Safety services"],
        ["Company website", "https://expired.company.example.test"],
        ["Authorized representative", "Company Expired OTP QA"],
        ["Business email", EMAIL],
        ["Business phone", "+923001114477"],
        ["Create password", "ExpiryBoundary!Password2026"],
        ["Confirm password", "ExpiryBoundary!Password2026"]
      ]) await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByLabel("Company size").selectOption("11-50");
      await page.getByLabel("I accept the HSE Verify terms for this Company application.").check();
      await page.getByLabel("I accept the privacy notice for Company verification data and evidence.").check();
      await page.getByRole("button", { name: "Create Company application", exact: true }).click();
      await page.waitForURL("**/company/register/verify");
      await page.getByText("Step 1 of 2", { exact: true }).waitFor();
      await page.goto(baseUrl + "/company/register/sandbox");
      await page.getByLabel("Business email").fill(EMAIL);
      await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
      await page.getByRole("button", { name: "Open latest email code", exact: true }).click();
      const output = page.getByRole("status", { name: "Latest Company registration code" });
      await output.waitFor();
      expiredCode = (await output.locator("strong").innerText()).trim();
      assert.match(expiredCode, /^[0-9]{6}$/);
    });

    // Change only disposable database timestamps while the Next server is fully stopped.
    const db = new PGlite(directory);
    try {
      const account = (await db.query("SELECT account_id,account_status,email_verified_at FROM auth_accounts WHERE email_normalized=$1", [EMAIL])).rows[0];
      assert.equal(account.account_status, "pending_email");
      assert.equal(account.email_verified_at, null);
      const challenge = (await db.query("SELECT challenge_id,attempts_remaining FROM auth_otp_challenges WHERE account_id=$1 AND purpose='registration_email' AND consumed_at IS NULL AND invalidated_at IS NULL", [account.account_id])).rows;
      assert.equal(challenge.length, 1);
      expiredId = challenge[0].challenge_id;
      assert.equal(challenge[0].attempts_remaining, 5);
      await db.query("UPDATE auth_otp_challenges SET created_at=CURRENT_TIMESTAMP-INTERVAL '20 minutes', expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute', resend_available_at=CURRENT_TIMESTAMP-INTERVAL '2 minutes' WHERE challenge_id=$1", [expiredId]);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1", [account.account_id])).rows[0].count, 0);
    } finally { await db.close(); }

    await phase(async () => {
      await page.setViewportSize({ width: 320, height: 740 });
      await page.goto(baseUrl + "/company/register/verify");
      await page.getByLabel("Email verification code").fill(expiredCode);
      await page.getByRole("button", { name: "Verify business email", exact: true }).click();
      await page.getByText("This Company email verification code expired. Request a new code.", { exact: true }).waitFor();
      await page.getByText("Step 1 of 2", { exact: true }).waitFor();
      const mobileLayout = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const overflowing = Array.from(document.querySelectorAll("body *")).filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.right > viewportWidth + 2 || rect.left < -2);
        }).slice(0, 14).map(element => ({
          tag: element.tagName.toLowerCase(),
          css: String(element.className ?? "").slice(0, 90),
          right: Math.round(element.getBoundingClientRect().right),
          left: Math.round(element.getBoundingClientRect().left),
          width: Math.round(element.getBoundingClientRect().width)
        }));
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const overflowingText = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!(node.textContent ?? "").trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const bounds = range.getBoundingClientRect();
          if (bounds.right > viewportWidth + 2 || bounds.left < -2) {
            overflowingText.push({
              text: node.textContent.trim().slice(0, 100),
              parent: node.parentElement?.tagName.toLowerCase(),
              css: String(node.parentElement?.className ?? "").slice(0, 70),
              right: Math.round(bounds.right),
              left: Math.round(bounds.left)
            });
          }
          if (overflowingText.length >= 12) break;
        }
        return {
          viewportWidth, documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          htmlRect: document.documentElement.getBoundingClientRect().toJSON(),
          bodyRect: document.body.getBoundingClientRect().toJSON(),
          overflowing, overflowingText
        };
      });
      assert(mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1, JSON.stringify(mobileLayout));

      const path = baseUrl + "/company/register/verify/resend";
      const forged = await context.request.post(path, { headers: { Origin: "https://foreign.example.test" }, maxRedirects: 0 });
      assert.equal(forged.status(), 403, "Cross-origin resend must be denied");
      const absent = await context.request.post(path, { maxRedirects: 0 });
      assert.equal(absent.status(), 403, "Origin-free resend must be denied");

      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Send new code", exact: true }).click();
      await page.waitForURL("**/company/register/verify?reason=resent");
      await page.getByText("A new verification code was created.", { exact: true }).waitFor();

      await page.getByLabel("Email verification code").fill(expiredCode);
      await page.getByRole("button", { name: "Verify business email", exact: true }).click();
      await page.getByText("The verification code is incorrect. 4 attempts remaining.", { exact: true }).waitFor();
      await page.getByText("Step 1 of 2", { exact: true }).waitFor();

      await page.goto(baseUrl + "/company/register/sandbox");
      await page.getByLabel("Business email").fill(EMAIL);
      await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
      await page.getByRole("button", { name: "Open latest email code", exact: true }).click();
      const latest = page.getByRole("status", { name: "Latest Company registration code" });
      await latest.waitFor();
      const freshCode = (await latest.locator("strong").innerText()).trim();
      assert.match(freshCode, /^[0-9]{6}$/);
      await page.goto(baseUrl + "/company/register/verify");
      await page.getByLabel("Email verification code").fill(freshCode);
      await page.getByRole("button", { name: "Verify business email", exact: true }).click();
      await page.getByText("Step 2 of 2", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    });

    assert.deepEqual(errors, [], "Company registration emitted client-side errors");
    const resultDb = new PGlite(directory);
    try {
      const account = (await resultDb.query("SELECT account_id,email_verified_at FROM auth_accounts WHERE email_normalized=$1", [EMAIL])).rows[0];
      assert.ok(account.email_verified_at, "Only a fresh email code may advance Company registration");
      const flow = (await resultDb.query("SELECT current_step,tenant_id,membership_id FROM company_registration_flows WHERE account_id=$1", [account.account_id])).rows[0];
      assert.equal(flow.current_step, "pending_mfa");
      assert.equal((await resultDb.query("SELECT tenant_status FROM platform_tenants WHERE tenant_id=$1", [flow.tenant_id])).rows[0].tenant_status, "pending");
      assert.equal((await resultDb.query("SELECT membership_status FROM auth_tenant_memberships WHERE membership_id=$1", [flow.membership_id])).rows[0].membership_status, "invited");
      assert.equal((await resultDb.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1", [account.account_id])).rows[0].count, 0);
      const challenges = (await resultDb.query("SELECT challenge_id,attempts_remaining,consumed_at,invalidated_at FROM auth_otp_challenges WHERE account_id=$1 ORDER BY created_at", [account.account_id])).rows;
      assert.equal(challenges.length, 2);
      const old = challenges.find(x => x.challenge_id === expiredId);
      assert.ok(old?.invalidated_at);
      assert.equal(old.consumed_at, null);
      assert.equal(old.attempts_remaining, 5, "Expired and replayed Company code must not burn attempts");
      const fresh = challenges.find(x => x.challenge_id !== expiredId);
      assert.ok(fresh?.consumed_at);
      assert.equal(fresh.attempts_remaining, 4,
        "A stale old code is rejected as an incorrect attempt against the fresh Company challenge");
      const verified = await resultDb.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.otp.verified'", [account.account_id]);
      assert.equal(verified.rows[0].count, 1);
      console.log("COMPANY_EXPIRED_OTP_ACTUAL_BROWSER_CROSS_ORIGIN_DENIED_STALE_REPLAY_DENIED_FRESH_VERIFIED");
    } finally { await resultDb.close(); }
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
