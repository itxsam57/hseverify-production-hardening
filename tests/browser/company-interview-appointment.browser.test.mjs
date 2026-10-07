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

import {assessorSchedulingPrincipal} from "../helpers/assessor-scheduling-native-principal.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");

test("Company sees the changed appointment at its actual notification destination", {timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),port=await freePort(),baseUrl="http://127.0.0.1:"+port,browser=await chromium.launch({headless:true});
 try{
  const scheduledAt=new Date(Date.now()+86400000).toISOString();
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt});
  const newTime=new Date(Date.now()+172800000).toISOString();
  await new InterviewSchedulingService(db).scheduleInterview({principal:await assessorSchedulingPrincipal(db,fixture.credentials.assessor),tenantId:fixture.credentials.company.tenantId,request:fixture.requests.Alpha,scheduledAt:newTime,rescheduleReason:"Worker requested another appointment"});
  const orderId=(await db.query("SELECT order_id FROM assurance_cases WHERE case_id=$1",[fixture.requests.Alpha.caseId])).rows[0].order_id;await db.close();
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/company/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   await login(page,baseUrl,fixture.credentials.company,"company");await page.goto(baseUrl+"/company/assurance-orders/"+orderId+"#"+fixture.requests.Alpha.caseId,{waitUntil:"domcontentloaded"});
   await page.getByRole("heading",{name:"Assurance order",exact:true}).waitFor();
   const row=page.locator("tr[id="+fixture.requests.Alpha.caseId+"]");assert.equal(await row.count(),1);
   assert.ok((await row.innerText()).includes(formatDateTime(newTime)),"Company interview notification opens its case but exposes no actual appointment time");
   assert.doesNotMatch(await row.innerText(),/Worker requested another appointment/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.reload({waitUntil:"domcontentloaded"});
   assert.ok((await row.innerText()).includes(formatDateTime(newTime)));
   const worker=await browser.newContext(),workerPage=await worker.newPage();await login(workerPage,baseUrl,fixture.credentials.worker,"worker");
   await workerPage.goto(baseUrl+"/company/assurance-orders/"+orderId,{waitUntil:"domcontentloaded"});await workerPage.getByRole("heading",{name:"Access denied",exact:true}).waitFor();await worker.close();
  }});
 }finally{await browser.close();await fixture.cleanup();}
});
