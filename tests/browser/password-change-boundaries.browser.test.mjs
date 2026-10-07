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
test("All six roles change passwords with reauthentication, keep current sessions and revoke other sessions",{timeout:300000},async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"hse-password-security-")),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,HSE_RELEASE_SHA:"password-security-browser",HSE_SESSION_SECRET:"password-security-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"password-security-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",HSE_AUDIT_CREDENTIALS_PATH:join(directory,"credentials.json")};
 const roles=["worker","company","assessor","verifier","admin","root"],changed={},notificationCookies={};let browser;
 const newPassword="ChangedPortal!Password2026";
 async function signIn(page,identity,role,password,offset){
  await page.goto(baseUrl+"/"+role+"/login");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password",{exact:true}).fill(password);
  if(identity.totpSecret){
   // The first login uses the previous counter so the second can use the current
   // counter without replay. Submit early enough that the previous code stays valid.
   if(offset===-1){
    const remaining=30_000-Date.now()%30_000;
    if(remaining<10_000)await new Promise(resolve=>setTimeout(resolve,remaining+20));
   }
   await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret,offset));
  }
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
 }
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment,probe:async()=>{
   browser=await chromium.launch({headless:true});
   for(const role of roles){
    const identity=credentials[role],context=await browser.newContext(),otherContext=await browser.newContext(),primary=await context.newPage(),other=await otherContext.newPage();
    await signIn(primary,identity,role,identity.password,-1);await primary.waitForURL("**/"+role+"/dashboard");
    await signIn(other,identity,role,identity.password,0);await other.waitForURL("**/"+role+"/dashboard");
    await primary.goto(baseUrl+"/account/security");
    const section=primary.locator("section").filter({has:primary.getByRole("heading",{name:"Change password",exact:true})});
    async function submit(password,mfa){
     await section.getByLabel("Current password",{exact:true}).fill(password);await section.getByLabel("New password",{exact:true}).fill(newPassword);await section.getByLabel("Confirm new password",{exact:true}).fill(newPassword);
     if(identity.totpSecret)await section.getByLabel("Current authenticator code",{exact:true}).fill(mfa);
     await section.getByRole("button",{name:"Change password",exact:true}).click();
    }
    await submit("WrongCurrent!Password2026",identity.totpSecret?totp(identity.totpSecret,1):"");
    await section.getByRole("alert").getByText("Current password is incorrect.",{exact:true}).waitFor();
    if(identity.totpSecret){
     const wrong=["111111","222222","333333","444444"].find(c=>![-1,0,1].map(o=>totp(identity.totpSecret,o)).includes(c));
     await submit(identity.password,wrong);await section.getByRole("alert").getByText("Authenticator code is invalid or already used.",{exact:true}).waitFor();
    }
    await other.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(other.url()).pathname,"/"+role+"/dashboard");
    await submit(identity.password,identity.totpSecret?totp(identity.totpSecret,1):"");
    await section.getByRole("status").getByText("Password changed. Other active sessions were revoked.",{exact:true}).waitFor();
    changed[role]=Math.floor(Date.now()/30000)+1;
    await primary.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(primary.url()).pathname,"/"+role+"/dashboard");
    await other.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(other.url()).pathname,"/"+role+"/login");
    await signIn(other,identity,role,identity.password,1);await other.getByRole("alert").waitFor();
    await other.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(other.url()).pathname,"/"+role+"/login");
    await context.close();await otherContext.close();
    console.log("ACTUAL_PASSWORD_CHANGE_BOUNDARIES",role,"wrong password/MFA denial, current session retained, other session and old password denied");
   }
   // One shared wait for the authenticator replay window; never mutate factor counters.
   const required=Math.max(...roles.filter(r=>r!=="worker").map(r=>changed[r]))*30000;
   if(Date.now()<required)await new Promise(resolve=>setTimeout(resolve,required-Date.now()+20));
   for(const role of roles){
    const context=await browser.newContext(),page=await context.newPage();
    await signIn(page,credentials[role],role,newPassword,1);await page.waitForURL("**/"+role+"/dashboard");
    notificationCookies[role]=await context.cookies();console.log("ACTUAL_REPLACEMENT_PASSWORD_LOGIN",role);await context.close();
   }
  }});
  const db=new PGlite(directory);try{
   for(const role of roles){
    const id=credentials[role].accountId,sessions=(await db.query("SELECT active_role,revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1 ORDER BY created_at",[id])).rows;
    assert.equal(sessions.length,3);assert.ok(sessions.every(s=>s.active_role===role));assert.equal(sessions[0].revoked_at,null);assert.ok(sessions[1].revoked_at);assert.equal(sessions[1].revocation_reason,"password_changed");assert.equal(sessions[2].revoked_at,null);assert.equal(sessions.filter(s=>s.revoked_at===null).length,2);
    const events=(await db.query("SELECT active_role,metadata FROM auth_security_events WHERE account_id=$1 AND event_type='password_changed'",[id])).rows;assert.deepEqual(events,[{active_role:role,metadata:{otherSessionsRevoked:true}}]);
    const audit=(await db.query("SELECT actor_account_id,actor_role,source_event_id,action_key FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.password.changed'",[id])).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_role,role);assert.equal(audit[0].actor_account_id,id);assert.ok(audit[0].source_event_id);
   }
   console.log("ACTUAL_SIX_ROLE_PASSWORD_CHANGE_DB: one native completion audit and exact three role-bound sessions per account, only the second revoked");
  }finally{await db.close();}
  await verifySecurityNotifications({browser,root,environment,baseUrl,port,credentials,roles,cookies:notificationCookies,titles:["Password changed"]});
 }finally{if(browser)await browser.close();await rm(directory,{recursive:true,force:true});}
});
