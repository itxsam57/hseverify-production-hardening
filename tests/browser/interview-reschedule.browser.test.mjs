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




import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {formatDateTime}=loadWorkerRegistrationTs("src/lib/format.ts");
test("Assessor reschedules through the real form and Worker sees the persisted appointment", {timeout:120000}, async()=>{
 const fixture=await assessorInterviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 const firstTime=new Date(Date.now()+86400000).toISOString().slice(0,16),nextTime=new Date(Date.now()+172800000).toISOString().slice(0,16),reason="Worker requested another appointment";
 const run=async(probe)=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",projectRoot:process.cwd(),environment:fixture.environment,probe});
 try{
  await run(async()=>{
   await login(page,baseUrl,fixture.credentials.assessor,"assessor");
   await page.goto(baseUrl+"/assessor/interviews",{waitUntil:"domcontentloaded"});
   const row=page.getByRole("row").filter({has:page.getByText(fixture.requests.Alpha.caseId,{exact:true})});
   await row.getByLabel("Interview time (UTC)").fill(firstTime);
   await row.getByRole("button",{name:"Schedule",exact:true}).click();
   await row.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor();
   await row.getByText(firstTime+":00.000Z",{exact:true}).waitFor();
  });
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_outbox_jobs WHERE job_type IN ('notification.interview.scheduled','email.interview.scheduled')")).rows[0].n,6);await db.close();
  await run(async()=>{
   await page.goto(baseUrl+"/assessor/interviews",{waitUntil:"domcontentloaded"});
   const row=page.getByRole("row").filter({has:page.getByText(fixture.requests.Alpha.caseId,{exact:true})}),form=row.locator("form").filter({has:page.getByRole("button",{name:"Reschedule interview",exact:true})});
   await form.getByLabel("Interview time (UTC)").fill(nextTime);
   await form.getByRole("button",{name:"Reschedule interview",exact:true}).click();
   assert.equal(await form.evaluate(node=>node.checkValidity()),false);
   await form.evaluate(node=>{node.noValidate=true;node.requestSubmit();});
   await page.getByText(/Check the interview time and provide a reschedule reason/).waitFor();
   await form.getByLabel("Interview time (UTC)").fill(nextTime);
   await form.getByLabel("Reschedule reason").fill(reason);
   await form.getByRole("button",{name:"Reschedule interview",exact:true}).click();
   await row.getByText(nextTime+":00.000Z",{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
  const persisted=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  const request=(await persisted.query("SELECT scheduled_at,reschedule_reason FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0];
  assert.equal(new Date(request.scheduled_at).toISOString(),nextTime+":00.000Z");assert.equal(request.reschedule_reason,reason);
  assert.equal((await persisted.query("SELECT count(*)::int AS n FROM platform_outbox_jobs WHERE job_type IN ('notification.interview.scheduled','email.interview.scheduled')")).rows[0].n,12);await persisted.close();
  await run(async()=>{
   const worker=await browser.newContext(),workerPage=await worker.newPage();await login(workerPage,baseUrl,fixture.credentials.worker,"worker");
   await workerPage.goto(baseUrl+"/worker/interviews/"+fixture.requests.Alpha.interviewRequestId,{waitUntil:"domcontentloaded"});
   await workerPage.getByText(formatDateTime(nextTime+":00.000Z"),{exact:true}).waitFor();
   await worker.close();
  });
  console.log("ACTUAL_RESCHEDULE_BROWSER initial schedule -> required reason -> persisted new time/reason and12 durable jobs -> Worker private record refresh; 390px no overflow");
 }finally{await browser.close();await fixture.cleanup();}
});
