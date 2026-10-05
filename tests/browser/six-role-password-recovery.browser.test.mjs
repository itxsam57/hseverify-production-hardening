import { verifySecurityNotifications } from "../helpers/account-security-notification-browser.mjs";
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
test("Six-role email recovery preserves MFA policy, revokes sessions and denies replay",{timeout:300000},async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"hse-six-role-recovery-")),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const key="six-role-recovery-synthetic-sandbox-key";
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,HSE_RELEASE_SHA:"six-role-recovery-probe",HSE_SESSION_SECRET:"six-role-recovery-synthetic-session-secret-20261005",HSE_AUTH_PEPPER:"six-role-recovery-synthetic-pepper-20261005",HSE_ENABLE_AUTH_SANDBOX:"true",HSE_AUTH_SANDBOX_ACCESS_KEY:key,HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 const roles=["worker","company","assessor","verifier","admin","root"],newPassword="RecoveredPortal!Password2026",notificationCookies={};let browser;
 async function signIn(page,identity,role,password,offset){await page.goto(baseUrl+"/"+role+"/login");await page.getByLabel("Email address").fill(identity.email);await page.getByLabel("Password",{exact:true}).fill(password);if(identity.totpSecret)await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret,offset));await page.getByRole("button",{name:"Sign in",exact:true}).click();}
 async function reset(page,code,password=newPassword,confirm=password){await page.getByLabel("Recovery code",{exact:true}).fill(code);await page.getByLabel("New password",{exact:true}).fill(password);await page.getByLabel("Confirm new password",{exact:true}).fill(confirm);await page.getByRole("button",{name:"Reset password and revoke sessions",exact:true}).click();}
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile("/tmp/independent-audit-credentials.json","utf8"));
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment,probe:async()=>{
   browser=await chromium.launch({headless:true});
   for(const role of roles){
    const identity=credentials[role],oldContext=await browser.newContext(),recoveryContext=await browser.newContext(),old=await oldContext.newPage(),page=await recoveryContext.newPage(),inbox=await recoveryContext.newPage(),replayContext=await browser.newContext();let cached;
    await signIn(old,identity,role,identity.password,-1);await old.waitForURL("**/"+role+"/dashboard");
    await page.goto(baseUrl+"/auth/recover?portal="+role);await page.getByLabel("Account email").fill(identity.email);await page.getByRole("button",{name:"Continue securely"}).click();await page.waitForURL("**/auth/recover/verify?portal="+role);
    await inbox.goto(baseUrl+"/worker/register/sandbox");await inbox.getByLabel("Delivery channel").selectOption("email");await inbox.getByLabel("Delivery destination").fill(identity.email);await inbox.getByLabel("Sandbox access key").fill(key);await inbox.getByRole("button",{name:"Open latest sandbox delivery"}).click();
    const status=inbox.getByRole("status",{name:"Latest sandbox verification code"});await status.waitFor();const code=(await status.locator("strong").innerText()).trim();
    await reset(page,code,newPassword,"Mismatch!Password2026");await page.getByRole("alert").getByText("The passwords do not match.",{exact:true}).waitFor();
    await page.getByRole("button",{name:"Send a new recovery code",exact:true}).click();await page.getByRole("alert").getByText("Wait before requesting another verification code.",{exact:true}).waitFor();
    await reset(page,String((Number(code)+1)%1000000).padStart(6,"0"));await page.getByRole("alert").getByText("The verification code is incorrect. 4 attempt(s) remain.",{exact:true}).waitFor();
    await old.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(old.url()).pathname,"/"+role+"/dashboard");
    await replayContext.addCookies(await recoveryContext.cookies());cached=await replayContext.newPage();await cached.goto(baseUrl+"/auth/recover/verify?portal="+role);
    await reset(page,code);await page.waitForURL("**/"+role+"/login?reason=password-reset");
    await reset(cached,code);await cached.getByRole("alert").getByText("This recovery request is no longer available.",{exact:true}).waitFor();
    await old.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(old.url()).pathname,"/"+role+"/login");
    await signIn(page,identity,role,identity.password,0);await page.getByRole("alert").waitFor();
    await page.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(page.url()).pathname,"/"+role+"/login");
    if(identity.totpSecret){await page.goto(baseUrl+"/"+role+"/login");await page.getByLabel("Email address").fill(identity.email);await page.getByLabel("Password",{exact:true}).fill(newPassword);const wrongMfa=["111111","222222","333333","444444"].find(c=>![-1,0,1].map(o=>totp(identity.totpSecret,o)).includes(c));await page.getByLabel("Authenticator code").fill(wrongMfa);await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.getByRole("alert").waitFor();await page.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(page.url()).pathname,"/"+role+"/login");}
    await signIn(page,identity,role,newPassword,0);await page.waitForURL("**/"+role+"/dashboard");
    notificationCookies[role]=await recoveryContext.cookies();console.log("ACTUAL_SIX_ROLE_RECOVERY_BROWSER",role,"mismatch/cooldown/wrong code/replay denied; old session/password denied; new password plus existing MFA accepted");
    await oldContext.close();await recoveryContext.close();await replayContext.close();
   }
  }});
  const db=new PGlite(directory);try{
   for(const role of roles){const id=credentials[role].accountId;
    const sessions=(await db.query("SELECT active_role,revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1 ORDER BY created_at",[id])).rows;assert.equal(sessions.length,2);assert.equal(sessions[0].active_role,role);assert.ok(sessions[0].revoked_at);assert.equal(sessions[0].revocation_reason,"password_reset");assert.equal(sessions[1].active_role,role);assert.equal(sessions[1].revoked_at,null);
    const flows=(await db.query("SELECT active_role,consumed_at FROM auth_recovery_flows WHERE account_id=$1",[id])).rows;assert.equal(flows.length,1);assert.equal(flows[0].active_role,role);assert.ok(flows[0].consumed_at);
    const challenges=(await db.query("SELECT attempts_remaining,consumed_at,invalidated_at FROM auth_otp_challenges WHERE account_id=$1 AND purpose='password_reset'",[id])).rows;assert.equal(challenges.length,1);assert.equal(challenges[0].attempts_remaining,4);assert.ok(challenges[0].consumed_at);assert.equal(challenges[0].invalidated_at,null);
    const failures=(await db.query("SELECT active_role,metadata FROM auth_security_events WHERE account_id=$1 AND event_type='otp_failed' AND metadata->>'purpose'='password_reset'",[id])).rows;assert.deepEqual(failures,[{active_role:role,metadata:{purpose:"password_reset",attemptsRemaining:4}}]);
    const completed=(await db.query("SELECT actor_account_id,actor_role,target_type,target_reference FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.password_reset.completed'",[id])).rows;assert.equal(completed.length,1);assert.equal(completed[0].actor_role,role);assert.equal(completed[0].actor_account_id,id);assert.equal(completed[0].target_type,"account");assert.equal(completed[0].target_reference,id);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE actor_account_id=$1 AND actor_role=$2 AND action_key='authentication.otp.failed'",[id,role])).rows[0].count,1);
    const factors=(await db.query("SELECT factor_status AS status FROM auth_mfa_factors WHERE account_id=$1",[id])).rows;assert.equal(factors.length,role==="worker"?0:1);if(role!=="worker")assert.equal(factors[0].status,"active");
   }
   console.log("ACTUAL_SIX_ROLE_RECOVERY_DB exact consumed flows/challenges, attempts4, role-bound audit, prior sessions revoked, existing MFA retained");
  }finally{await db.close();}
  await verifySecurityNotifications({browser,root,environment,baseUrl,port,credentials,roles,cookies:notificationCookies,titles:["Password reset"]});
 }finally{if(browser)await browser.close();await rm(directory,{recursive:true,force:true});}
});
