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

const SANDBOX_KEY = "duplicate-recovery-test-sandbox-key-2026";
const NEW_PASSWORD = "RecoveredWorker!Password2026";
async function identitySnapshot(db, accountId) {
  const result = {};
  for (const [key, sql] of Object.entries({
    account: "SELECT account_id,email_normalized,phone_e164,display_name,account_status,worker_reference,email_verified_at,phone_verified_at,created_at FROM auth_accounts WHERE account_id=$1",
    roles: "SELECT * FROM auth_account_roles WHERE account_id=$1 ORDER BY role",
    identities: "SELECT * FROM worker_identities WHERE worker_account_id=$1 ORDER BY identity_id",
    identityVersions: "SELECT v.* FROM worker_identity_versions v JOIN worker_identities i ON i.identity_id=v.identity_id WHERE i.worker_account_id=$1 ORDER BY v.identity_version_id",
    evidence: "SELECT * FROM worker_evidence_records WHERE worker_account_id=$1 ORDER BY record_id",
    evidenceVersions: "SELECT v.* FROM worker_evidence_versions v JOIN worker_evidence_records r ON r.record_id=v.record_id WHERE r.worker_account_id=$1 ORDER BY v.version_id",
    skills: "SELECT s.* FROM worker_skill_versions s JOIN worker_evidence_versions v ON v.version_id=s.version_id JOIN worker_evidence_records r ON r.record_id=v.record_id WHERE r.worker_account_id=$1 ORDER BY s.version_id"
  })) result[key] = (await db.query(sql, [accountId])).rows;
  result.accountCount = (await db.query("SELECT count(*)::int AS count FROM auth_accounts")).rows[0].count;
  result.registrationFlows = (await db.query("SELECT * FROM auth_registration_flows ORDER BY flow_id")).rows;
  return result;
}
async function duplicate(page, baseUrl, email, phone) {
  await page.goto(baseUrl + "/worker/register");
  await page.getByLabel("Full name").fill("Conflicting Registration Name");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Mobile phone").fill(phone);
  await page.getByLabel("Country", {exact:true}).fill("Pakistan");
  await page.getByLabel("Create password").fill("DuplicateContact!Password2026");
  await page.getByLabel("Confirm password").fill("DuplicateContact!Password2026");
  await page.getByLabel("I accept the HSE Verify terms for this Worker account.", {exact:true}).check();
  await page.getByLabel("I accept the privacy notice for Worker registration data.", {exact:true}).check();
  await page.getByRole("button", {name:"Create Worker account", exact:true}).click();
  await page.getByRole("alert").getByText("Registration cannot be started with these details. Check the information or use Worker sign in.", {exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname, "/worker/register");
}
async function reset(page, code) {
  await page.getByLabel("Recovery code", {exact:true}).fill(code);
  await page.getByLabel("New password", {exact:true}).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", {name:"Reset password and revoke sessions", exact:true}).click();
}
test("Duplicate Worker contacts deny identity merging; recovery persists failures and revokes old sessions", {timeout:240000}, async()=>{
  const root=process.cwd(), directory=await mkdtemp(join(tmpdir(),"hse-worker-duplicate-recovery-"));
  const port=await freePort(), baseUrl="http://127.0.0.1:"+port;
  const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,HSE_RELEASE_SHA:"worker-duplicate-recovery-browser",
    HSE_SESSION_SECRET:"duplicate-recovery-session-secret-with-more-than-thirty-two",HSE_AUTH_PEPPER:"duplicate-recovery-pepper-with-more-than-thirty-two",
    HSE_ENABLE_AUTH_SANDBOX:"true",HSE_AUTH_SANDBOX_ACCESS_KEY:SANDBOX_KEY,HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  let browser, baseline, passwordBefore, code;
  async function phase(probe) {await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment,probe});}
  try {
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]) {
      const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);
    }
    const credentials=JSON.parse(await readFile("/tmp/independent-audit-credentials.json","utf8")), worker=credentials.worker;
    browser=await chromium.launch({headless:true});
    const oldContext=await browser.newContext();let oldPage=await oldContext.newPage();
    const recoveryContext=await browser.newContext(), inbox=await recoveryContext.newPage();let page=await recoveryContext.newPage();
    await phase(async()=>{
      await login(oldPage,baseUrl,worker,"worker");
      await oldPage.goto(baseUrl+"/worker/identity");
      for(const [label,value] of [["Legal first name","Recovery"],["Legal last name","Worker"],["Date of birth","1992-04-18"],["Nationality","Pakistani"],["Country of residence","Pakistan"]]) await oldPage.getByLabel(label).fill(value);
      await Promise.all([oldPage.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/identity")),oldPage.getByRole("button",{name:"Save identity details"}).click()]);
      await oldPage.goto(baseUrl+"/worker/evidence");
      await oldPage.getByLabel("Record type").selectOption("skill");
      await Promise.all([oldPage.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")),oldPage.getByRole("button",{name:"Create draft"}).click()]);
      await oldPage.reload();
      const article=oldPage.locator("article").filter({hasText:"Skill record"}).first();
      await article.getByRole("textbox",{name:"Skill",exact:true}).fill("Recovery preserved safety skill");
      await Promise.all([oldPage.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")),article.getByRole("button",{name:"Save metadata"}).click()]);
      await oldPage.reload();
    });
    {const db=new PGlite(directory);try{baseline=await identitySnapshot(db,worker.accountId);passwordBefore=(await db.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[worker.accountId])).rows[0].password_hash;assert.equal(baseline.identities.length,1);assert.equal(baseline.evidence.length,1);assert.equal(baseline.skills[0].skill_name,"Recovery preserved safety skill");}finally{await db.close();}}
    await phase(async()=>{
      for(const [email,phone] of [[worker.email,"+923008884401"],["duplicate.new.contact@example.test","+923009876540"],[worker.email,"+923009876540"]]) await duplicate(page,baseUrl,email,phone);
      console.log("ACTUAL_DUPLICATE_WORKER_BROWSER: three contact conflicts denied");
      await page.goto(baseUrl+"/auth/recover?portal=worker");
      await page.getByLabel("Account email").fill(worker.email);
      await page.getByRole("button",{name:"Continue securely"}).click();
      await page.waitForURL("**/auth/recover/verify?portal=worker");
      await inbox.goto(baseUrl+"/worker/register/sandbox");
      await inbox.getByLabel("Delivery channel").selectOption("email");
      await inbox.getByLabel("Delivery destination").fill(worker.email);
      await inbox.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
      await inbox.getByRole("button",{name:"Open latest sandbox delivery"}).click();
      const status=inbox.getByRole("status",{name:"Latest sandbox verification code"});await status.waitFor();
      code=(await status.locator("strong").innerText()).trim();
      await reset(page,String((Number(code)+1)%1000000).padStart(6,"0"));
      await page.getByRole("alert").getByText("The verification code is incorrect. 4 attempt(s) remain.",{exact:true}).waitFor();
      await oldPage.goto(baseUrl+"/worker/dashboard");
      assert.equal(new URL(oldPage.url()).pathname,"/worker/dashboard","Wrong recovery code revoked a session");
    });
    // Close development pages before the next server start to avoid HMR racing a navigation.
    // Context cookies remain intact and normal fresh forms are rendered after restart.
    await page.close();await oldPage.close();
    {const db=new PGlite(directory);try{
      assert.deepEqual(await identitySnapshot(db,worker.accountId),baseline);
      assert.equal((await db.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[worker.accountId])).rows[0].password_hash,passwordBefore);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[worker.accountId])).rows[0].count,1);
      const challenge=(await db.query("SELECT attempts_remaining,consumed_at,invalidated_at FROM auth_otp_challenges WHERE account_id=$1 AND purpose='password_reset'",[worker.accountId])).rows;
      assert.deepEqual(challenge,[{attempts_remaining:4,consumed_at:null,invalidated_at:null}]);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_security_events WHERE account_id=$1 AND event_type='otp_failed' AND metadata->>'purpose'='password_reset'",[worker.accountId])).rows[0].count,1);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.otp.failed'",[worker.accountId])).rows[0].count,1);
      console.log("ACTUAL_RECOVERY_REJECTION_DB: decrement and failure audit committed; password, session and identity unchanged");
    }finally{await db.close();}}
    await phase(async()=>{
      page=await recoveryContext.newPage();oldPage=await oldContext.newPage();
      await page.goto(baseUrl+"/auth/recover/verify?portal=worker");
      await reset(page,code);
      await page.waitForURL("**/worker/login?reason=password-reset");
      await oldPage.goto(baseUrl+"/worker/dashboard");
      assert.equal(new URL(oldPage.url()).pathname,"/worker/login");
      await page.getByLabel("Email address").fill(worker.email);await page.getByLabel("Password").fill(worker.password);
      await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.getByRole("alert").waitFor();
      await page.goto(baseUrl+"/worker/dashboard");assert.equal(new URL(page.url()).pathname,"/worker/login");
      await login(page,baseUrl,{...worker,password:NEW_PASSWORD},"worker");
      await page.goto(baseUrl+"/worker/evidence");await page.locator('input[value="Recovery preserved safety skill"]').waitFor();
      console.log("ACTUAL_WORKER_RECOVERY_BROWSER: wrong-code denial, valid recovery, old-session denial, old-password denial, replacement login");
    });
    const db=new PGlite(directory);
    try{
      assert.deepEqual(await identitySnapshot(db,worker.accountId),baseline,"Recovery or duplicates changed existing identity/evidence or merged accounts");
      const sessions=(await db.query("SELECT active_role,revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1 ORDER BY created_at",[worker.accountId])).rows;
      assert.equal(sessions.length,2);assert.equal(sessions[0].revocation_reason,"password_reset");assert.ok(sessions[0].revoked_at);assert.equal(sessions[1].revoked_at,null);
      const challenges=(await db.query("SELECT attempts_remaining,consumed_at FROM auth_otp_challenges WHERE account_id=$1 AND purpose='password_reset'",[worker.accountId])).rows;
      assert.equal(challenges.length,1);assert.ok(challenges[0].consumed_at);
      assert.equal(challenges[0].attempts_remaining,4,"Wrong recovery code did not persist the attempt decrement");
      const failures=(await db.query("SELECT active_role,metadata FROM auth_security_events WHERE account_id=$1 AND event_type='otp_failed' AND metadata->>'purpose'='password_reset'",[worker.accountId])).rows;
      assert.equal(failures.length,1);assert.equal(failures[0].active_role,"worker");assert.equal(failures[0].metadata.attemptsRemaining,4);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action_key='authentication.otp.failed' AND actor_account_id=$1",[worker.accountId])).rows[0].count,1);
      const flows=(await db.query("SELECT active_role,consumed_at FROM auth_recovery_flows WHERE account_id=$1",[worker.accountId])).rows;
      assert.equal(flows.length,1);assert.equal(flows[0].active_role,"worker");assert.ok(flows[0].consumed_at);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE action_key='authentication.password_reset.completed' AND actor_account_id=$1 AND actor_role='worker'",[worker.accountId])).rows[0].count,1);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_security_events WHERE event_type='access_denied' AND metadata->>'reason'='contact_conflict'")).rows[0].count,3);
      console.log("ACTUAL_WORKER_RECOVERY_DB: unchanged identity/evidence, consumed flow/challenge, remaining attempts, exact immutable failure/completion audit and session revocation");
    }finally{await db.close();}
  }finally{if(browser)await browser.close();await rm(directory,{recursive:true,force:true});}
});
