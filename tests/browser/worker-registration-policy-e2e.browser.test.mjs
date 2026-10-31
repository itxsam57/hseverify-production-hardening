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

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("Could not allocate port."));
        else resolve(address.port);
      });
    });
  });
}
test("Worker registration denies missing policies/country and password mismatch, then cancels the same signup while retaining server-dated acceptance", {timeout:180000}, async()=>{
  const root = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-worker-policy-browser-"));
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "worker-policy-browser-e2e",
    HSE_SESSION_SECRET: "worker-policy-browser-session-secret-2026-more-than-thirty-two",
    HSE_AUTH_PEPPER: "worker-policy-browser-auth-pepper-2026-more-than-thirty-two",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false",
    HSE_ENABLE_AUTH_SANDBOX: "true",
    HSE_AUTH_SANDBOX_ACCESS_KEY: "registration-consent-red-synthetic-sandbox-key-2026"
  };

  let registrationCookies=[], registeredAccountId, registeredFlowId;

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: root, env: environment, encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);


    const dbBefore = new PGlite(databaseDirectory);
    const baseline = await dbBefore.query("SELECT count(*)::int AS count FROM auth_accounts");
    await dbBefore.close();
    const startedAt = Date.now();
    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/worker/register", projectRoot: root, environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          const errors = [];
          page.on("pageerror", error => errors.push(error.message));
          const terms = page.getByLabel("I accept the HSE Verify terms for this Worker account.", { exact: true });
          const privacy = page.getByLabel("I accept the privacy notice for Worker registration data.", { exact: true });
          const submit = async () => {
            const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/worker/register");
            await page.getByRole("button", { name: "Create Worker account", exact: true }).click();
            assert.equal((await response).status(), 200);
          };
          let releaseScripts;
          const scriptsReady = new Promise(resolve => { releaseScripts = resolve; });
          await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, async route => {
            await scriptsReady;
            await route.continue();
          });
          try {
            await page.goto(baseUrl + "/worker/register", { waitUntil: "commit" });
            await page.getByLabel("Full name").waitFor();
            for (const label of ["Full name", "Email address", "Mobile phone", "Country", "Create password", "Confirm password"]) {
              assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true, label + " was editable before readiness");
            }
            assert.equal(await page.locator('input[name="companyCode"]').isDisabled(), true);
            assert.equal(await terms.isDisabled(), true);
            assert.equal(await privacy.isDisabled(), true);
            assert.equal(await page.getByRole("button", { name: "Create Worker account", exact: true }).isDisabled(), true);
          } finally { releaseScripts(); }
          await page.waitForLoadState("load");
          await page.unroute(/\/_next\/static\/.*\.js(?:\?.*)?$/);
          await page.getByLabel("Full name").fill("Ready Worker");
          await terms.check();
          assert.equal(await page.getByLabel("Full name").inputValue(), "Ready Worker");
          await page.getByLabel("Full name").fill("");
          await terms.uncheck();
          await submit();
          await page.getByText("Check the highlighted registration details.", { exact: true }).waitFor();
          await page.getByText("Confirm your password.", { exact: true }).waitFor();
          await page.getByText("Enter a valid country.", { exact: true }).waitFor();
          await page.getByText("Accept the terms to continue.", { exact: true }).waitFor();
          await page.getByText("Accept the privacy notice to continue.", { exact: true }).waitFor();
          assert.equal(await terms.getAttribute("aria-invalid"), "true");
          assert.equal(await privacy.getAttribute("aria-invalid"), "true");

          await page.getByLabel("Full name").fill("Policy Browser Worker");
          await page.getByLabel("Email address").fill("policy.browser.worker@example.test");
          await page.getByLabel("Mobile phone").fill("+923008881102");
          await page.getByLabel("Create password").fill("PolicyBrowser!Password2026");
          await page.getByLabel("Confirm password").fill("PolicyBrowser!Password2026");
          await page.getByLabel("Country", { exact: true }).fill("Pakistan");
          await terms.check();
          await privacy.check();
          for (const invalid of [
            { label: "Full name", value: "x", reset: "Policy Browser Worker", error: "Display name must contain between 2 and 120 characters." },
            { label: "Email address", value: "invalid-email", reset: "policy.browser.worker@example.test", error: "Enter a valid email address." },
            { label: "Mobile phone", value: "123", reset: "+923008881102", error: "Enter a phone number in international format, for example +923001234567." },
            { label: "Create password", value: "short", reset: "PolicyBrowser!Password2026", error: "Password must contain between 12 and 128 characters." },
            { label: "Create password", value: "weakpassword2026", reset: "PolicyBrowser!Password2026", error: "Password must include uppercase, lowercase, number and symbol characters." }
          ]) {
            await page.getByLabel(invalid.label, { exact: true }).fill(invalid.value);
            if (invalid.label === "Create password") await page.getByLabel("Confirm password").fill(invalid.value);
            await submit();
            await page.getByText(invalid.error, { exact: true }).waitFor();
            assert.equal(new URL(page.url()).pathname, "/worker/register");
            assert.equal(await page.getByLabel(invalid.label, { exact: true }).inputValue(), invalid.value);
            await page.getByLabel(invalid.label, { exact: true }).fill(invalid.reset);
            if (invalid.label === "Create password") await page.getByLabel("Confirm password").fill(invalid.reset);
          }
          await page.getByLabel("Confirm password").fill("DifferentPolicy!Password2026");
          await submit();
          await page.getByText("The passwords do not match.", { exact: true }).waitFor();
          assert.equal(new URL(page.url()).pathname, "/worker/register");
          assert.equal(await page.getByLabel("Email address").inputValue(), "policy.browser.worker@example.test");

          await page.getByLabel("Confirm password").fill("PolicyBrowser!Password2026");
          await page.getByLabel("Country", { exact: true }).fill("");
          await submit();
          await page.getByText("Enter a valid country.", { exact: true }).waitFor();
          assert.equal(new URL(page.url()).pathname, "/worker/register");

          await page.getByLabel("Country", { exact: true }).fill("Pakistan ");
          await terms.uncheck();
          await submit();
          await page.getByText("Accept the terms to continue.", { exact: true }).waitFor();
          assert.equal(new URL(page.url()).pathname, "/worker/register");

          await terms.check();
          await privacy.uncheck();
          await submit();
          await page.getByText("Accept the privacy notice to continue.", { exact: true }).waitFor();
          assert.equal(new URL(page.url()).pathname, "/worker/register");

          await privacy.check();
          await page.evaluate(() => {
            const field = document.createElement("input");
            field.type = "hidden"; field.name = "acceptedAt"; field.value = "2099-01-01T00:00:00.000Z";
            document.querySelector("form").append(field);
          });
          await page.getByRole("button", { name: "Create Worker account", exact: true }).click();
          await page.waitForURL("**/worker/register/verify");
          await page.getByText("Step 1 of 2", { exact: false }).waitFor();
          registrationCookies=await page.context().cookies();
          assert.deepEqual(errors, []);
        } finally { await browser.close(); }
      }
    });
    const db = new PGlite(databaseDirectory);
    try {
      const total = await db.query("SELECT count(*)::int AS count FROM auth_accounts");
      assert.equal(total.rows[0].count, baseline.rows[0].count + 1);
      const accounts = await db.query("SELECT account_id,account_status FROM auth_accounts WHERE email_normalized='policy.browser.worker@example.test'");
      assert.equal(accounts.rows.length, 1);
      assert.equal(accounts.rows[0].account_status, "pending_email");
      const accountId = accounts.rows[0].account_id;
      registeredAccountId=accountId;
      const flow = await db.query("SELECT flow_id,current_step FROM auth_registration_flows WHERE account_id=$1", [accountId]);
      assert.equal(flow.rows.length, 1);
      assert.equal(flow.rows[0].current_step, "pending_email");
      registeredFlowId=flow.rows[0].flow_id;
      const otp = await db.query("SELECT purpose,code_hash FROM auth_otp_challenges WHERE account_id=$1", [accountId]);
      assert.equal(otp.rows.length, 1);
      assert.equal(otp.rows[0].purpose, "registration_email");
      assert.ok(otp.rows[0].code_hash);
      const history = await db.query("SELECT actor_account_id,actor_role,occurred_at,metadata FROM platform_audit_events WHERE metadata->>'stage'='policy_acceptance' AND actor_account_id=$1", [accountId]);
      assert.equal(history.rows.length, 1, "A denied registration saved acceptance history.");
      const row = history.rows[0];
      assert.equal(row.actor_account_id, accountId);
      assert.equal(row.actor_role, "worker");
      assert.equal(row.metadata.actorAccountId, accountId);
      assert.equal(row.metadata.flowId, flow.rows[0].flow_id);
      assert.equal(row.metadata.country, "Pakistan");
      assert.deepEqual(row.metadata.terms, { accepted: true, version: "worker-registration-terms-v1" });
      assert.deepEqual(row.metadata.privacy, { accepted: true, version: "worker-registration-privacy-v1" });
      const recorded = new Date(row.occurred_at).getTime();
      assert.ok(recorded >= startedAt && recorded <= Date.now(), "Registration accepted a caller-supplied acceptance timestamp.");
    } finally { await db.close(); }
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],
      probeUrl:baseUrl+"/worker/register",projectRoot:root,environment,
      probe:async()=>{
        const browser=await chromium.launch({headless:true});
        try{
          const context=await browser.newContext();await context.addCookies(registrationCookies);
          const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
          await page.goto(baseUrl+"/worker/register/verify");
          await page.getByText("Step 1 of 2",{exact:false}).waitFor();
          await page.getByText("Cancel this registration",{exact:true}).click();
          await page.getByRole("button",{name:"Cancel and start again",exact:true}).click();
          await page.waitForURL("**/worker/register?reason=cancelled");
          await page.goto(baseUrl+"/worker/register/verify");
          await page.waitForURL(url=>url.pathname==="/worker/register");
          assert.equal(new URL(page.url()).searchParams.get("reason"),"restart");
          assert.deepEqual(errors,[]);
        }finally{await browser.close();}
      }
    });
    const cancelled=new PGlite(databaseDirectory);
    try{
      for(const table of ["auth_accounts","reviewer_capacity_locks","auth_registration_flows","auth_otp_challenges"])
        assert.equal((await cancelled.query("SELECT count(*)::int n FROM "+table+" WHERE account_id=$1",[registeredAccountId])).rows[0].n,0,table+" retained cancelled signup");
      const retained=(await cancelled.query("SELECT metadata FROM platform_audit_events WHERE actor_account_id=$1 AND metadata->>'stage'='policy_acceptance'",[registeredAccountId])).rows;
      assert.equal(retained.length,1);assert.equal(retained[0].metadata.flowId,registeredFlowId);
      assert.equal((await cancelled.query("SELECT count(*)::int n FROM platform_audit_events WHERE actor_account_id=$1 AND metadata->>'reason'='user_cancelled'",[registeredAccountId])).rows[0].n,1);
    }finally{await cancelled.close();}
  } finally { await rm(databaseDirectory, { recursive: true, force: true }); }
});
