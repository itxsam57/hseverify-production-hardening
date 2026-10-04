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
test("All six role sessions reject invalid credentials and cross-portal access and distinguish Exit from sign-out",{timeout:300000},async()=>{
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

    const roles = ["worker", "company", "assessor", "verifier", "admin", "root"];
    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/worker/login", projectRoot: root, environment,
      probe: async () => {
        const browser = await chromium.launch({headless: true});
        try {
          for (const role of roles) {
            const context = await browser.newContext();
            const page = await context.newPage();
            const identity = credentials[role];
            try {
              for (const target of roles.filter(target => target !== role)) {
                await page.goto(baseUrl + "/" + target + "/login");
                await page.getByLabel("Email address").fill(identity.email);
                await page.getByLabel("Password").fill(identity.password);
                if (target !== "worker") {
                  await page.getByLabel("Authenticator code").fill(identity.totpSecret ? totp(identity.totpSecret) : "000000");
                }
                await page.getByRole("button", { name: "Sign in", exact: true }).click();
                await page.locator('[role="alert"]').waitFor();
                assert.equal(new URL(page.url()).pathname, "/" + target + "/login");
                await page.goto(baseUrl + "/" + target + "/dashboard");
                assert.equal(new URL(page.url()).pathname, "/" + target + "/login", role + " signed in as " + target);
              }
              await page.goto(baseUrl + "/" + role + "/login");
              await page.getByLabel("Email address").fill(identity.email);
              await page.getByLabel("Password").fill("WrongPassword!2026");
              if(identity.totpSecret) await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
              await page.getByRole("button",{name:"Sign in",exact:true}).click();
              await page.locator('[role="alert"]').waitFor();
              assert.equal(new URL(page.url()).pathname,"/"+role+"/login");
              await page.goto(baseUrl+"/"+role+"/dashboard");
              assert.equal(new URL(page.url()).pathname,"/"+role+"/login");
              if(identity.totpSecret) {
                await page.getByLabel("Email address").fill(identity.email);
                await page.getByLabel("Password").fill(identity.password);
                const valid=[-1,0,1].map(offset=>totp(identity.totpSecret,offset));
                const wrong=["111111","222222","333333","444444"].find(code=>!valid.includes(code));
                await page.getByLabel("Authenticator code").fill(wrong);
                await page.getByRole("button",{name:"Sign in",exact:true}).click();
                await page.locator('[role="alert"]').waitFor();
                await page.goto(baseUrl+"/"+role+"/dashboard");
                assert.equal(new URL(page.url()).pathname,"/"+role+"/login");
              }
              await login(page,baseUrl,identity,role);
              for(const other of roles.filter(other=>other!==role)) {
                await page.goto(baseUrl+"/"+other+"/dashboard");
                assert.equal(new URL(page.url()).pathname,"/access-denied",role+" crossed into "+other);
                await page.getByRole("heading", { name: "Access denied", exact: true }).waitFor();
                await page.getByText("Your active portal role is", { exact: false }).waitFor();
              }
              await page.goto(baseUrl+"/"+role+"/dashboard");
              await page.locator("details.profile-menu summary").click();
              await page.getByRole("link",{name:"Exit portal",exact:true}).click();
              await page.waitForURL(baseUrl+"/");
              await page.goto(baseUrl+"/"+role+"/dashboard");
              assert.equal(new URL(page.url()).pathname,"/"+role+"/dashboard");
              await page.locator("details.profile-menu summary").click();
              await page.locator("details.profile-menu").getByRole("button", { name: "Sign out", exact: true }).click();
              await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
              await page.goto(baseUrl + "/" + role + "/dashboard");
              assert.equal(new URL(page.url()).pathname, "/" + role + "/dashboard");
              await page.locator("details.profile-menu summary").click();
              await page.locator("details.profile-menu").getByRole("button", { name: "Sign out", exact: true }).click();
              await page.getByRole("dialog").getByRole("button", { name: "Sign out", exact: true }).click();
              await page.waitForURL(url=>url.pathname==="/"+role+"/login");
              await page.goto(baseUrl+"/"+role+"/dashboard");
              assert.equal(new URL(page.url()).pathname,"/"+role+"/login");
              console.log("Verified authentication boundaries for",role);
            } finally {await context.close();}
          }
        } finally {await browser.close();}
      }
    });
    const db=new PGlite(databaseDirectory);
    try {
      const sessions=await db.query("SELECT session_id,account_id,active_role,revoked_at,revocation_reason FROM auth_sessions");
      const denials = await db.query("SELECT account_id,active_role FROM auth_security_events WHERE event_type='access_denied' AND metadata->>'area'='sign_in' AND metadata->>'reason'='role_not_assigned'");
      assert.equal(denials.rows.length, 30);
      const failures = await db.query("SELECT account_id,event_type FROM auth_security_events WHERE event_type IN ('login_failed','mfa_failed')");
      assert.equal(failures.rows.filter(row => row.event_type === "login_failed").length, 11);
      assert.equal(failures.rows.filter(row => row.event_type === "mfa_failed").length, 5);
      for (const role of roles) {
        const accountFailures = failures.rows.filter(row => row.account_id === credentials[role].accountId);
        assert.equal(accountFailures.filter(row => row.event_type === "login_failed").length, role === "worker" ? 1 : 2);
        assert.equal(accountFailures.filter(row => row.event_type === "mfa_failed").length, role === "worker" ? 0 : 1);
      }

      for (const role of roles) {
        const deniedRoles = denials.rows.filter(row => row.account_id === credentials[role].accountId).map(row => row.active_role).sort();
        assert.deepEqual(deniedRoles, roles.filter(target => target !== role).sort());
      }
      const portalDenials = await db.query("SELECT account_id,active_role,metadata FROM auth_security_events WHERE event_type='access_denied' AND metadata->>'reason'='role_mismatch'");
      for (const role of roles) {
        const ownSession = sessions.rows.find(row => row.account_id === credentials[role].accountId);
        assert.ok(ownSession);
        const ownDenials = portalDenials.rows.filter(row => row.account_id === credentials[role].accountId);
        assert.deepEqual([...new Set(ownDenials.map(row => row.metadata.expectedRole))].sort(), roles.filter(target => target !== role).sort());
        assert.ok(ownDenials.every(row => row.active_role === role && row.metadata.sessionId === ownSession.session_id));
      }
      const logouts = await db.query("SELECT account_id,active_role,metadata FROM auth_security_events WHERE event_type='logout'");
      assert.equal(logouts.rows.length, roles.length);
      for (const role of roles) {
        const logout = logouts.rows.filter(row => row.account_id === credentials[role].accountId);
        assert.equal(logout.length, 1);
        assert.equal(logout[0].active_role, role);
        assert.equal(logout[0].metadata.reason, "user_logout");
      }
      assert.equal(sessions.rows.length,roles.length,"Rejected credentials created a session.");
      for(const role of roles) {
        const rows=sessions.rows.filter(row=>row.account_id===credentials[role].accountId);
        assert.equal(rows.length,1);
        assert.equal(rows[0].active_role,role);
        assert.ok(rows[0].revoked_at,"Sign-out did not revoke "+role+" session.");
        assert.equal(rows[0].revocation_reason, "user_logout");
      }
    } finally {await db.close();}
  } finally {await rm(databaseDirectory,{recursive:true,force:true});}
});
