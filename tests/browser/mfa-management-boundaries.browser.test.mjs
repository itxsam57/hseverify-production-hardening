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
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {hashOpaqueValue,decryptSecret,createIdentifier}=loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
test("Five MFA-protected roles rotate recovery codes and replace authenticators with exact persisted audit and factor state",{timeout:300000},async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"hse-mfa-security-")),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,HSE_RELEASE_SHA:"mfa-security-browser",HSE_SESSION_SECRET:"mfa-security-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"mfa-security-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 const roles=["company","assessor","verifier","admin","root"],generated={},secrets={},oldCounters={},oldHashes={},notificationCookies={},preRecoverySessions={};let browser;
 async function signIn(page,identity,role,secret,offset){await page.goto(baseUrl+"/"+role+"/login");await page.getByLabel("Email address").fill(identity.email);await page.getByLabel("Password",{exact:true}).fill(identity.password);await page.getByLabel("Authenticator code").fill(totp(secret,offset));await page.getByRole("button",{name:"Sign in",exact:true}).click();}
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile("/tmp/independent-audit-credentials.json","utf8"));
  // Existing unused codes belong to each account; rotation must replace the entire set.
  const seedDb=new PGlite(directory);try{
   for(const role of roles){
    oldHashes[role]=[];
    for(let i=0;i<10;i++){
     const hash=hashOpaqueValue("OLD1-CODE-"+String(i).padStart(4,"0"),environment.HSE_AUTH_PEPPER,"mfa-recovery");oldHashes[role].push(hash);
     await seedDb.query("INSERT INTO auth_mfa_recovery_codes(recovery_code_id,account_id,code_hash,created_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)",[createIdentifier("mfa_recovery"),credentials[role].accountId,hash]);
    }
   }
  }finally{await seedDb.close();}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/root/login",projectRoot:root,environment,probe:async()=>{
   browser=await chromium.launch({headless:true});
   for(const role of roles){
    const identity=credentials[role],context=await browser.newContext(),page=await context.newPage();
    await signIn(page,identity,role,identity.totpSecret,-1);await page.waitForURL("**/"+role+"/dashboard");await page.goto(baseUrl+"/account/security");
    const recovery=page.locator("details").filter({has:page.locator("summary").getByText("Rotate recovery codes",{exact:true})});
    await recovery.locator("summary").click();await recovery.getByLabel("Current password").fill(identity.password);await recovery.getByLabel("Current authenticator code").fill(totp(identity.totpSecret));
    await recovery.getByRole("button",{name:"Generate new recovery codes",exact:true}).click();
    await recovery.getByText("Recovery codes rotated. Save these codes now; they are shown once.",{exact:true}).waitFor();
    generated[role]=await recovery.locator("li code").allInnerTexts();assert.equal(generated[role].length,10);assert.equal(new Set(generated[role]).size,10);assert.ok(generated[role].every(c=>/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)));
    const replacement=page.locator("details").filter({has:page.locator("summary").getByText("Replace authenticator",{exact:true})});
    await replacement.locator("summary").click();await replacement.getByLabel("Current password").fill(identity.password);await replacement.getByLabel("Current authenticator code").fill(totp(identity.totpSecret,1));
    await replacement.getByRole("button",{name:"Start authenticator replacement",exact:true}).click();oldCounters[role]=Math.floor(Date.now()/30000)+1;
    await replacement.getByText("Add the new secret to your authenticator, then confirm one code.",{exact:true}).waitFor();
    secrets[role]=(await replacement.locator("code").first().innerText()).trim();
    await replacement.getByLabel("Code from new authenticator").fill(totp(secrets[role]));
    await replacement.getByRole("button",{name:"Confirm replacement",exact:true}).click();await replacement.getByText("Authenticator replaced successfully.",{exact:true}).waitFor();
    console.log("ACTUAL_MFA_MANAGEMENT_BROWSER",role,"old code set replaced, replacement confirmed");
    await context.close();
   }
   // Use a fresh counter so old-factor denial cannot be explained by replay protection.
   const required=Math.max(...Object.values(oldCounters))*30000;
   if(Date.now()<required)await new Promise(resolve=>setTimeout(resolve,required-Date.now()+20));
   for(const role of roles){
    const identity=credentials[role],loginContext=await browser.newContext(),loginPage=await loginContext.newPage();
    await signIn(loginPage,identity,role,identity.totpSecret,1);await loginPage.getByRole("alert").waitFor();
    await loginPage.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(loginPage.url()).pathname,"/"+role+"/login");
    await signIn(loginPage,identity,role,secrets[role],1);await loginPage.waitForURL("**/"+role+"/dashboard");
    notificationCookies[role]=await loginContext.cookies();console.log("ACTUAL_FRESH_OLD_FACTOR_DENIAL",role,"fresh old factor denied and new factor accepted");await loginContext.close();
   }
  }});
  const db=new PGlite(directory);try{
   for(const role of roles){
    const id=credentials[role].accountId;
    const codes=(await db.query("SELECT code_hash,used_at FROM auth_mfa_recovery_codes WHERE account_id=$1",[id])).rows;assert.equal(codes.length,10);assert.ok(codes.every(c=>c.used_at===null));assert.ok(codes.every(c=>!oldHashes[role].includes(c.code_hash)),"Old recovery code remained usable in stored set");assert.deepEqual(codes.map(c=>c.code_hash).sort(),generated[role].map(c=>hashOpaqueValue(c,environment.HSE_AUTH_PEPPER,"mfa-recovery")).sort());
    const factors=(await db.query("SELECT encrypted_secret,factor_status,revoked_at FROM auth_mfa_factors WHERE account_id=$1",[id])).rows;assert.equal(factors.length,2);
    const active=factors.filter(f=>f.factor_status==="active"),revoked=factors.filter(f=>f.factor_status==="revoked");assert.equal(active.length,1);assert.equal(revoked.length,1);assert.ok(revoked[0].revoked_at);assert.equal(decryptSecret(active[0].encrypted_secret,environment.HSE_AUTH_PEPPER),secrets[role]);assert.equal(decryptSecret(revoked[0].encrypted_secret,environment.HSE_AUTH_PEPPER),credentials[role].totpSecret);
    const challenges=(await db.query("SELECT consumed_at FROM auth_mfa_rotation_challenges WHERE account_id=$1",[id])).rows;assert.equal(challenges.length,1);assert.ok(challenges[0].consumed_at);
    for(const [event,action] of [["mfa_recovery_codes_rotated","authentication.mfa.recovery_codes.rotated"],["mfa_replaced","authentication.mfa.replaced"]]){
     const events=(await db.query("SELECT event_id,active_role FROM auth_security_events WHERE account_id=$1 AND event_type=$2",[id,event])).rows;assert.equal(events.length,1);assert.equal(events[0].active_role,role);
     const audit=(await db.query("SELECT actor_account_id,actor_role,source_event_id,target_type,target_reference FROM platform_audit_events WHERE actor_account_id=$1 AND action_key=$2",[id,action])).rows;assert.deepEqual(audit,[{actor_account_id:id,actor_role:role,source_event_id:events[0].event_id,target_type:"account",target_reference:id}]);
    }
    preRecoverySessions[role]=(await db.query("SELECT session_id,active_role FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[id])).rows;
    assert.deepEqual((await db.query("SELECT active_role,revoked_at FROM auth_sessions WHERE account_id=$1",[id])).rows,[{active_role:role,revoked_at:null},{active_role:role,revoked_at:null}]);
   }
   console.log("ACTUAL_FIVE_ROLE_MFA_MANAGEMENT_DB: exact ten code hashes, old revoked/new active factors, consumed challenge and immutable role-bound completion audits");
  }finally{await db.close();}

  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/root/login",projectRoot:root,environment,probe:async()=>{
   async function codeLogin(page,role,code,password=credentials[role].password){
    await page.goto(baseUrl+"/"+role+"/login");
    await page.getByLabel("Email address").fill(credentials[role].email);
    await page.getByLabel("Password",{exact:true}).fill(password);
    await page.getByLabel("Authenticator code").fill(code);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
   }
   for(const [index,role] of roles.entries()){
    const acceptedContext=await browser.newContext(),deniedContext=await browser.newContext(),page=await acceptedContext.newPage(),denied=await deniedContext.newPage();
    try {
     await codeLogin(page,role,generated[role][0],"WrongRecovery!Password2026");await page.getByRole("alert").waitFor();
     await page.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(page.url()).pathname,"/"+role+"/login");
     await codeLogin(page,role,generated[role][0]);await page.waitForURL("**/"+role+"/dashboard");
     await page.goto(baseUrl+"/account/security");await page.getByText("Unused recovery codes:",{exact:false}).filter({has:page.locator("strong")}).waitFor();assert.equal(await page.locator("p").filter({hasText:"Unused recovery codes:"}).locator("strong").innerText(),"9");
     for(const code of [generated[role][0],"OLD1-CODE-0000",generated[roles[(index+1)%roles.length]][1]]){
      await codeLogin(denied,role,code);await denied.getByRole("alert").waitFor();await denied.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(denied.url()).pathname,"/"+role+"/login");
     }
     console.log("ACTUAL_FIVE_ROLE_RECOVERY_CODE_LOGIN",role,"wrong password denied without consumption; fresh code accepted once; replay, old set and foreign account code denied");
    } finally {await acceptedContext.close();await deniedContext.close();}
   }
  }});
  const recoveryDb=new PGlite(directory);try {
   for(const role of roles){
    const id=credentials[role].accountId,codes=(await recoveryDb.query("SELECT code_hash,used_at FROM auth_mfa_recovery_codes WHERE account_id=$1",[id])).rows;
    assert.equal(codes.length,10);const used=codes.filter(c=>c.used_at!==null);assert.equal(used.length,1);assert.ok(used[0].code_hash===hashOpaqueValue(generated[role][0],environment.HSE_AUTH_PEPPER,"mfa-recovery"));
    const events=(await recoveryDb.query("SELECT event_id,active_role FROM auth_security_events WHERE account_id=$1 AND event_type='mfa_succeeded' AND metadata->>'method'='recovery_code'",[id])).rows;assert.equal(events.length,1);assert.equal(events[0].active_role,role);
    const audit=(await recoveryDb.query("SELECT actor_role,source_event_id FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.mfa.succeeded' AND source_event_id=$2",[id,events[0].event_id])).rows;assert.deepEqual(audit,[{actor_role:role,source_event_id:events[0].event_id}]);
    const sessions=(await recoveryDb.query("SELECT session_id,active_role,revoked_at FROM auth_sessions WHERE account_id=$1",[id])).rows;assert.equal(sessions.length,3);assert.ok(sessions.every(row=>row.active_role===role&&row.revoked_at===null));assert.equal(sessions.filter(row=>!preRecoverySessions[role].some(before=>before.session_id===row.session_id)).length,1);
   }
   console.log("ACTUAL_RECOVERY_CODE_LOGIN_DB exact one used/nine unused codes, one method-bound MFA audit and one new role-bound session per account");
  } finally {await recoveryDb.close();}
  await verifySecurityNotifications({browser,root,environment,baseUrl,port,credentials,roles,cookies:notificationCookies,titles:["Recovery codes replaced", "Authenticator replaced"]});
 }finally{if(browser)await browser.close();await rm(directory,{recursive:true,force:true});}
});
