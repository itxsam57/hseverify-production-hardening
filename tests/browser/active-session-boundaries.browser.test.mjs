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
test("Six-role active sessions preserve foreign accounts, revoke owned other and current sessions", {timeout:300000}, async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"hse-session-security-")),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,HSE_AUDIT_CREDENTIALS_PATH:join(directory,"credentials.json"),HSE_RELEASE_SHA:"session-security-browser",HSE_SESSION_SECRET:"session-security-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"session-security-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 const roles=["worker","company","assessor","verifier","admin","root"],targets={};let browser;
 async function signIn(page,identity,role,offset){
  await page.goto(baseUrl+"/"+role+"/login");
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password",{exact:true}).fill(identity.password);
  if(identity.totpSecret){
   // The previous counter reserves the current one for the second session.
   // Submit early enough that it remains inside the unchanged MFA window.
   if(offset===-1){
    const remaining=30_000-Date.now()%30_000;
    if(remaining<10_000)await new Promise(resolve=>setTimeout(resolve,remaining+20));
   }
   await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret,offset));
  }
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard");
 }

 const current=page=>page.locator("article").filter({has:page.getByRole("heading",{name:"Current session",exact:true})});
 try {
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment,probe:async()=>{
   browser=await chromium.launch({headless:true});
   const victimContexts={},victimPages={},victimIds={};
   for(const role of ["worker","root"]){
    const context=await browser.newContext(),page=await context.newPage();await signIn(page,credentials[role],role,-1);await page.goto(baseUrl+"/account/sessions");victimContexts[role]=context;victimPages[role]=page;victimIds[role]=await current(page).locator('input[name="sessionId"]').inputValue();
   }
   for(const role of roles){
    const identity=credentials[role],context=await browser.newContext(),otherContext=await browser.newContext(),page=await context.newPage(),other=await otherContext.newPage();
    await signIn(page,identity,role,role==="root"?0:-1);await signIn(other,identity,role,role==="root"?1:0);
    await page.goto(baseUrl+"/account/sessions");await other.goto(baseUrl+"/account/sessions");
    const own=await current(page).locator('input[name="sessionId"]').inputValue(),otherId=await current(other).locator('input[name="sessionId"]').inputValue(),foreignRole=role==="worker"?"root":"worker";
    targets[role]={own,other:otherId};
    const rowsBefore=await page.locator("article").count();
    await current(page).locator('input[name="sessionId"]').evaluate((el,value)=>{el.value=value;},victimIds[foreignRole]);
    await current(page).getByRole("button",{name:"Sign out this session",exact:true}).click();
    await page.waitForURL("**/account/sessions");await page.reload();
    await current(page).getByRole("heading",{name:"Current session",exact:true}).waitFor();assert.equal(await page.locator("article").count(),rowsBefore);
    await victimPages[foreignRole].goto(baseUrl+"/"+foreignRole+"/dashboard");assert.equal(new URL(victimPages[foreignRole].url()).pathname,"/"+foreignRole+"/dashboard");
    const otherRow=page.locator("article").filter({has:page.locator('input[name="sessionId"][value="'+otherId+'"]')});
    await otherRow.getByRole("button",{name:"Revoke session",exact:true}).click();await page.reload();assert.equal(await page.locator("article").count(),rowsBefore-1);
    await other.goto(baseUrl+"/"+role+"/dashboard");assert.equal(new URL(other.url()).pathname,"/"+role+"/login");
    await current(page).getByRole("button",{name:"Sign out this session",exact:true}).click();await page.waitForURL("**/"+role+"/login?reason=signed-out");
    await page.goto(baseUrl+"/account/sessions");assert.equal(new URL(page.url()).pathname,"/worker/login");
    console.log("ACTUAL_SIX_ROLE_SESSION_BROWSER",role,"foreign tamper denied, own other revoked, self signout and protected-page denial");
    await context.close();await otherContext.close();
   }
   for(const context of Object.values(victimContexts))await context.close();
  }});
  const db=new PGlite(directory);try{
   for(const role of roles){
    const id=credentials[role].accountId;
    const rows=(await db.query("SELECT session_id,active_role,revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1",[id])).rows;
    for(const target of Object.values(targets[role])){const row=rows.find(s=>s.session_id===target);assert.equal(row.active_role,role);assert.ok(row.revoked_at);assert.equal(row.revocation_reason,"user_revoked");}
    const kept=rows.filter(s=>!Object.values(targets[role]).includes(s.session_id));assert.equal(kept.length,["worker","root"].includes(role)?1:0);assert.ok(kept.every(s=>s.revoked_at===null));
    const events=(await db.query("SELECT event_id,active_role,metadata FROM auth_security_events WHERE account_id=$1 AND event_type='session_revoked'",[id])).rows;assert.equal(events.length,2);
    for(const event of events){assert.equal(event.active_role,role);assert.ok(Object.values(targets[role]).includes(event.metadata.targetSessionId));assert.equal(event.metadata.self,event.metadata.targetSessionId===targets[role].own);}
    const audit=(await db.query("SELECT actor_role,source_event_id FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.session.revoked'",[id])).rows;assert.equal(audit.length,2);assert.ok(audit.every(a=>a.actor_role===role&&events.some(e=>e.event_id===a.source_event_id)));
   }
   console.log("ACTUAL_SIX_ROLE_SESSION_DB exact owned revocations, foreign sessions retained, self metadata and immutable completion audits");
  }finally{await db.close();}
 }finally{if(browser)await browser.close();await rm(directory,{recursive:true,force:true});}
});
