import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
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



import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
test("Actual Admin operations exposes required scheduling email health from persisted producer",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true});
 const temporary=await mkdtemp(join(tmpdir(),"hse-operational-email-browser-"));
 try{
  const adminActor=await assessorSchedulingPrincipal(db,fixture.credentials.assessor);await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[adminActor.accountId]);
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:new Date(Date.now()+86400000).toISOString()});
  assert.equal((await db.query("SELECT count(*)::int AS total FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows[0].total,3);await db.close();
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   await login(page,baseUrl,fixture.credentials.assessor,"admin");
   await page.goto(baseUrl+"/admin/operations",{waitUntil:"domcontentloaded"});
   assert.equal(await page.getByRole("heading",{name:"Interview email delivery",exact:true}).count(),1,"Required operational scheduling email health is not visible");
   await page.getByText("Queued: 3",{exact:true}).waitFor();
   const providers = page.getByRole("list", {name:"Provider integrations", exact:true});
   await providers.getByText("email: ready (sandbox) — local_fixture_available. Live availability: not checked.", {exact:true}).waitFor();
   await providers.getByText("sms: disabled (external_unavailable) — external_configuration_required. Live availability: not checked.", {exact:true}).waitFor();
  }});
  const build=spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{encoding:"utf8"});assert.equal(build.status,0,build.stderr);
  for(let i=0;i<6;i++) {
   const job=spawnSync(process.execPath,["scripts/run-outbox-worker.mjs","--once"],{env:fixture.environment,encoding:"utf8",timeout:20000});assert.equal(job.status,0,job.stderr);
   assert.match(job.stdout,i<3?/"status":"succeeded"/:/"status":"retry_wait"/);
  }
  const detail=async(label)=>(await page.getByText(label,{exact:true}).locator("..").locator("dd").textContent()).trim();
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   await page.goto(baseUrl+"/admin/operations",{waitUntil:"domcontentloaded"});
   await page.getByText("Retrying: 3",{exact:true}).waitFor();await page.getByText("Queue depth: 3",{exact:true}).waitFor();
   assert.equal(await detail("Attempt failure rate in the last 24 hours"),"100%");
   assert.notEqual(await detail("Next scheduled retry"),"None scheduled");
  }});
  const retryDb=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  const due=(await retryDb.query("SELECT max(next_attempt_at) AS due FROM platform_outbox_jobs WHERE job_type='email.interview.scheduled'")).rows[0].due;await retryDb.close();
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,new Date(due).getTime()-Date.now()+100)));
  const preload=join(temporary,"controlled-health-email.mjs");
  await writeFile(preload,'import assert from "node:assert/strict";let calls=0;globalThis.fetch=async(url)=>{assert.equal(String(url),"https://api.resend.com/emails");return new Response(JSON.stringify({id:"controlled-health-browser-"+(++calls)}),{status:200});};');
  const configured={...fixture.environment,HSE_OTP_EMAIL_API_KEY:"configured-operations-key",HSE_OTP_EMAIL_FROM:"notifications@example.test",HSE_PUBLIC_BASE_URL:baseUrl};
  for(let i=0;i<3;i++) {
   const job=spawnSync(process.execPath,["--import",preload,"scripts/run-outbox-worker.mjs","--once"],{env:configured,encoding:"utf8",timeout:20000});assert.equal(job.status,0,job.stderr);assert.match(job.stdout,/"status":"succeeded"/);
  }
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",projectRoot:process.cwd(),environment:configured,probe:async()=>{
   await page.goto(baseUrl+"/admin/operations",{waitUntil:"domcontentloaded"});
   await page.getByText("Sent: 3",{exact:true}).waitFor();await page.getByText("Queue depth: 0",{exact:true}).waitFor();
   assert.equal(await detail("Attempt failure rate in the last 24 hours"),"50%");assert.equal(await detail("Completed send attempts (accepted or failed) in the last 24 hours"),"6");
   assert.notEqual(await detail("Last provider acceptance"),"None recorded");assert.equal(await detail("Next scheduled retry"),"None scheduled");
   await page.getByText("Configuration: Configured (Resend)",{exact:true}).waitFor();
   await page.getByRole("list", {name:"Provider integrations", exact:true}).getByText("email: configured (external) — configured_not_verified. Live availability: not checked.", {exact:true}).waitFor();
   await page.getByText("Configuration and local test adapters do not confirm live availability or delivery. No provider check is performed by this page.", {exact:true}).waitFor();
   assert.equal(await detail("Delivery confirmation"),"Unavailable");assert.doesNotMatch(await page.locator("body").innerText(),/configured-operations-key|notifications@example.test/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const foreign=await browser.newContext(),foreignPage=await foreign.newPage();await login(foreignPage,baseUrl,fixture.credentials.worker,"worker");
   const denied=await foreignPage.goto(baseUrl+"/admin/operations",{waitUntil:"domcontentloaded"});assert.ok(denied.status()<500);assert.equal(new URL(foreignPage.url()).pathname,"/access-denied");await foreignPage.getByRole("heading",{name:"Access denied",exact:true}).waitFor();assert.equal(await foreignPage.getByRole("heading",{name:"Interview email delivery",exact:true}).count(),0);await foreign.close();
  }});
  console.log("ACTUAL_ADMIN_EMAIL_HEALTH_BROWSER real producer and CLI queued3 -> retry3/100%attemptfailure -> Sent3/50%; configured is not provider health or confirmed delivery; 390px no overflow");
 }finally{await browser.close();await fixture.cleanup();await rm(temporary,{recursive:true,force:true});}
});

