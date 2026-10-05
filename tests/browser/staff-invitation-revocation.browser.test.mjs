import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";



const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode32(value) {
  let bits = 0, acc = 0;
  const bytes = [];
  for (const char of value.toUpperCase().replace(/=+$/g, "")) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
      acc &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}
function totp(secret, stepOffset = 0) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const digest = createHmac("sha1", decode32(secret)).update(message).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
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
async function login(page, baseUrl, identity, role) {
  await page.goto(baseUrl + "/" + role + "/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if (identity.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/" + role + "/dashboard", { timeout: 20_000 });
}
test("Issuer revocation blocks a fresh token and an already-open enrollment",{timeout:300000},async()=>{
  const root = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-auth-boundary-"));
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "auth-boundaries-browser-e2e",
    HSE_SESSION_SECRET: "auth-boundaries-browser-session-secret-2026-more-than-thirty-two",
    HSE_AUTH_PEPPER: "auth-boundaries-browser-auth-pepper-2026-more-than-thirty-two",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: root, env: environment, encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);
    const seed = spawnSync(process.execPath, ["scripts/independent-audit-seed.mjs"], {
      cwd: root, env: environment, encoding: "utf8"
    });
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    const credentials = JSON.parse(await readFile("/tmp/independent-audit-credentials.json", "utf8"));

    let revokeControls;
    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/root/login", projectRoot: root, environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await login(page, baseUrl, credentials.root, "root");
          await page.goto(baseUrl + "/root/staff");
          await page.getByLabel("Staff email").fill("revoke.probe.staff@example.test");
          await page.getByLabel("Portal role").selectOption("verifier");
          await page.getByRole("button", { name: "Create one-time invitation", exact: true }).click();
          await page.locator(".security-key-card strong").waitFor();
          const invitationPath = await page.locator(".security-key-card strong").innerText();
          const recipientContext = await browser.newContext();
          const recipient = await recipientContext.newPage();
          await recipient.goto(baseUrl + invitationPath);
          await recipient.getByRole("heading", {name: "Create account credentials", exact: true}).waitFor();
          await recipient.getByLabel("Full name").fill("Revoked Browser Staff");
          await recipient.getByLabel("Create password", {exact: true}).fill("RevokedBrowser!Password2026");
          await recipient.getByLabel("Confirm password", {exact: true}).fill("RevokedBrowser!Password2026");
          await page.reload();
          const card = page.locator("article").filter({ hasText: "revoke.probe.staff@example.test" });
          await card.getByText("pending", { exact: true }).waitFor();
          revokeControls = await card.getByRole("button", { name: /revoke/i }).count();
          assert.equal(revokeControls, 1);
          await card.getByRole("button", {name: "Revoke invitation", exact: true}).click();
          await card.getByText("revoked", {exact: true}).waitFor();
          await recipient.getByRole("button", {name: "Continue to authenticator setup", exact: true}).click();
          await recipient.getByText("This staff invitation is invalid, expired or already used.", {exact: true}).waitFor();
          await recipient.reload();
          await recipient.getByRole("heading", {name: "Invitation unavailable", exact: true}).waitFor();
          await recipient.goto(baseUrl + invitationPath);
          await recipient.getByRole("heading", {name: "Invitation unavailable", exact: true}).waitFor();
          console.log("ACTUAL_BROWSER_REVOKED_FRESH_AND_CACHED_PROFILE_DENIED");
          await recipientContext.close();
          await page.getByLabel("Staff email").fill("revoke.mfa.staff@example.test");
          await page.getByLabel("Portal role").selectOption("assessor");
          await page.getByRole("button", {name: "Create one-time invitation", exact: true}).click();
          await page.waitForFunction(previous => document.querySelector(".security-key-card strong")?.textContent !== previous, invitationPath);
          const mfaInvitationPath = await page.locator(".security-key-card strong").innerText();
          const mfaContext = await browser.newContext();
          const mfaPage = await mfaContext.newPage();
          await mfaPage.goto(baseUrl + mfaInvitationPath);
          await mfaPage.getByLabel("Full name").fill("Revoked MFA Staff");
          await mfaPage.getByLabel("Create password", {exact: true}).fill("RevokedMfa!Password2026");
          await mfaPage.getByLabel("Confirm password", {exact: true}).fill("RevokedMfa!Password2026");
          await mfaPage.getByRole("button", {name: "Continue to authenticator setup", exact: true}).click();
          await mfaPage.getByRole("heading", {name: "Add HSE Verify to an authenticator app", exact: true}).waitFor();
          const setupKey = await mfaPage.locator(".security-key-card strong").innerText();
          await page.reload();
          const mfaCard = page.locator("article").filter({hasText: "revoke.mfa.staff@example.test"});
          await mfaCard.getByRole("button", {name: "Revoke invitation", exact: true}).click();
          await mfaCard.getByText("revoked", {exact: true}).waitFor();
          await mfaPage.getByLabel("Authenticator code").fill(totp(setupKey));
          await mfaPage.getByRole("button", {name: "Activate MFA and finish enrollment", exact: true}).click();
          await mfaPage.getByText("This staff invitation is invalid, expired or already used.", {exact: true}).waitFor();
          await mfaPage.reload();
          await mfaPage.getByRole("heading", {name: "Invitation unavailable", exact: true}).waitFor();
          await mfaPage.goto(baseUrl + mfaInvitationPath);
          await mfaPage.getByRole("heading", {name: "Invitation unavailable", exact: true}).waitFor();
          console.log("ACTUAL_BROWSER_REVOKED_CACHED_VALID_MFA_DENIED");
          await mfaContext.close();
        } finally { await browser.close(); }
      }
    });
    const db = new PGlite(databaseDirectory);
    try {
      const rows = (await db.query("SELECT role,invitation_status FROM auth_staff_invitations WHERE email_normalized=$1", ["revoke.probe.staff@example.test"])).rows;
      assert.deepEqual(rows, [{ role: "verifier", invitation_status: "revoked" }]);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_accounts WHERE email_normalized=$1", ["revoke.probe.staff@example.test"])).rows[0].count, 0);
      const flows = (await db.query("SELECT current_step FROM auth_staff_enrollment_flows WHERE invitation_id IN (SELECT invitation_id FROM auth_staff_invitations WHERE email_normalized=$1)", ["revoke.probe.staff@example.test"])).rows;
      assert.deepEqual(flows, [{current_step: "cancelled"}]);
      const audit = (await db.query("SELECT actor_role,target_type FROM platform_audit_events WHERE action_key='authentication.invitation.revoked'")).rows;
      assert.equal(audit.length, 2);
      assert.ok(audit.every(row => row.actor_role === "root" && row.target_type === "invitation"));
      assert.equal((await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized='revoke.mfa.staff@example.test'")).rows.length, 0);
      const mfaFlows = (await db.query("SELECT current_step,account_id,factor_id FROM auth_staff_enrollment_flows WHERE invitation_id IN (SELECT invitation_id FROM auth_staff_invitations WHERE email_normalized='revoke.mfa.staff@example.test')")).rows;
      assert.deepEqual(mfaFlows, [{current_step: "cancelled", account_id: null, factor_id: null}]);
      assert.equal((await db.query("SELECT audit_event_id FROM platform_audit_events WHERE action_key='authentication.password.created' AND actor_role='assessor'")).rows.length, 1);
      console.log("ACTUAL_DB_REVOKED_CANCELLED_NO_ACCOUNT_AND_IMMUTABLE_AUDIT");
    } finally { await db.close(); }
    assert.equal(revokeControls, 1, "Pending staff invitation lacks issuer revocation control.");
  } finally { await rm(databaseDirectory, { recursive: true, force: true }); }
});
