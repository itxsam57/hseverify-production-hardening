import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";

import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
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
function totp(secret) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
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



import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";

import {spawnSync} from "node:child_process";

import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
test("Current consumer notifications page exposes owned queued scheduling email",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true});
 try{
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+86400000).toISOString()});
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows[0].total,3);await db.close();
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   await login(page,baseUrl,fixture.credentials.worker,"worker");
   await page.goto(baseUrl+"/worker/notifications",{waitUntil:"domcontentloaded"});
   assert.equal(await page.getByRole("heading",{name:"Email delivery",exact:true}).count(),1,"Required consumer email delivery state is not visible");
   const items=page.locator(".email-delivery-item");assert.equal(await items.count(),1);assert.match(await items.innerText(),/Queued/);
  }});
 }finally{await browser.close();await fixture.cleanup();}
});

import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
test("Browser email states follow actual worker retries and accepted messages with private role links",{timeout:180000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),temporary=await mkdtemp(join(tmpdir(),"hse-email-state-browser-")),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),worker=await browser.newContext({viewport:{width:390,height:844}}),workerPage=await worker.newPage();
 const server=probe=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe});
 let db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+86400000).toISOString()});
  await db.close();db=null;
  await server(async()=>{
   await login(workerPage,baseUrl,fixture.credentials.worker,"worker");
   await workerPage.goto(baseUrl+"/worker/notifications",{waitUntil:"domcontentloaded"});
   const item=workerPage.locator(".email-delivery-item");assert.equal(await item.count(),1);assert.equal(await item.locator(".status-badge").innerText(),"Queued");
   assert.equal(await workerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
  const build=spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{encoding:"utf8"});assert.equal(build.status,0,build.stderr);
  for(let i=0;i<6;i++){
   const result=spawnSync(process.execPath,["scripts/run-outbox-worker.mjs","--once"],{env:fixture.environment,encoding:"utf8",timeout:20000});
   assert.equal(result.status,0,result.stderr);assert.match(result.stdout,i<3?/"status":"succeeded"/:/"status":"retry_wait"/);
  }
  await server(async()=>{
   await workerPage.goto(baseUrl+"/worker/notifications",{waitUntil:"domcontentloaded"});
   const item=workerPage.locator(".email-delivery-item");assert.equal(await item.count(),1);assert.equal(await item.locator(".status-badge").innerText(),"Retrying");
  });
  const log=join(temporary,"calls.jsonl"),preload=join(temporary,"controlled-mail.mjs");
  await writeFile(preload,'import assert from "node:assert/strict";import {appendFileSync} from "node:fs";globalThis.fetch=async(url,options)=>{assert.equal(String(url),"https://api.resend.com/emails");const message=JSON.parse(options.body);appendFileSync('+JSON.stringify(log)+',JSON.stringify({key:options.headers["Idempotency-Key"],message})+"\\n");return new Response(JSON.stringify({id:"native-browser-"+options.headers["Idempotency-Key"]}),{status:200});};');
  db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
   const retryAt=(await db.query("SELECT max(next_attempt_at) AS due FROM platform_outbox_jobs WHERE job_type='email.interview.scheduled'")).rows[0].due;
   await db.close();db=null;
   const delay=Math.max(0,new Date(retryAt).getTime()-Date.now()+100);assert.ok(delay<10000,"First retry unexpectedly delayed beyond its contract");
   await new Promise(resolve=>setTimeout(resolve,delay));
   const env={...fixture.environment,HSE_OTP_EMAIL_API_KEY:"configured-browser-provider-key",HSE_OTP_EMAIL_FROM:"notifications@example.test",HSE_PUBLIC_BASE_URL:baseUrl};
  for(let i=0;i<3;i++){
   const result=spawnSync(process.execPath,["--import",preload,"scripts/run-outbox-worker.mjs","--once"],{env,encoding:"utf8",timeout:20000});
   assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"status":"succeeded"/);
  }
  const calls=(await readFile(log,"utf8")).trim().split("\n").map(line=>JSON.parse(line));assert.equal(calls.length,3);
  assert.equal(new Set(calls.map(call=>call.key)).size,3);
  let workerLink;
  await server(async()=>{
   for(const role of ["worker","assessor","company"]){
    const context=role==="worker"?worker:await browser.newContext({viewport:{width:role==="assessor"?1440:390,height:900}}),page=role==="worker"?workerPage:await context.newPage();
    if(role!=="worker")await login(page,baseUrl,fixture.credentials[role],role);
    await page.goto(baseUrl+"/"+role+"/notifications",{waitUntil:"domcontentloaded"});
    const item=page.locator(".email-delivery-item");assert.equal(await item.count(),1);assert.equal(await item.locator(".status-badge").innerText(),"Sent");
    assert.match(await item.innerText(),/Delivery has not been confirmed/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const received=calls.find(call=>call.message.to[0].toLowerCase()===fixture.credentials[role].email.toLowerCase());assert.ok(received);
    const href=received.message.text.match(/http:\/\/\S+$/)[0];assert.ok(href.startsWith(baseUrl+"/"+role+"/"));
    if(role==="worker")workerLink=href;
    const response=await page.goto(href,{waitUntil:"domcontentloaded"});assert.equal(response.status(),200);
    if(role==="worker")await page.getByRole("heading",{name:"Structured competency interview",exact:true}).waitFor();
    if(role==="assessor")await page.getByRole("heading",{name:"Case "+fixture.requests.Alpha.caseId,exact:true}).waitFor();
    if(role==="company")assert.equal(await page.locator("tr[id="+fixture.requests.Alpha.caseId+"]").count(),1);
   }
   const foreign=await browser.newContext(),page=await foreign.newPage();
   await login(page,baseUrl,{email:"search.foreign@example.test",password:fixture.credentials.worker.password},"worker");
   await page.goto(baseUrl+"/worker/notifications",{waitUntil:"domcontentloaded"});
   assert.equal(await page.locator(".email-delivery-item").count(),0);await page.getByText("No interview emails yet.",{exact:true}).waitFor();
   const denied=await page.goto(workerLink,{waitUntil:"domcontentloaded"});assert.equal(denied.status(),404);
   assert.equal(await page.getByRole("heading",{name:"Structured competency interview",exact:true}).count(),0);
  });
  db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  const rows=(await db.query("SELECT status,attempt_count,delivered_at FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows;
  assert.equal(rows.length,3);for(const row of rows){assert.equal(row.status,"sent");assert.equal(row.attempt_count,2);assert.equal(row.delivered_at,null);}
  console.log("ACTUAL_EMAIL_STATE_BROWSER queued -> native CLI unconfigured retry -> configured controlled acceptance; three private role links, unrelated account denied, 390/1440px no overflow; no live provider certificate");
 }finally{await db?.close();await browser.close();await fixture.cleanup();await rm(temporary,{recursive:true,force:true});}
});
