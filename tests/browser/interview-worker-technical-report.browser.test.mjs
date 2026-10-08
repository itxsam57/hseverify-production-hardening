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




test("Worker technical reporting is hidden before scheduling and persists inside the join window",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true});
 const run=probe=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe});
 try{
  await run(async()=>{
   const wc=await browser.newContext({viewport:{width:390,height:844}}),worker=await wc.newPage();
   await login(worker,baseUrl,fixture.credentials.worker,"worker");
   await worker.goto(baseUrl+"/worker/interviews/"+fixture.requests.Alpha.interviewRequestId,{waitUntil:"domcontentloaded"});
   await worker.getByText("Awaiting schedule",{exact:true}).waitFor();
   assert.equal(await worker.getByRole("button",{name:"Record technical issue",exact:true}).count(),0,"Unscheduled Worker must not initialize runtime through technical reporting");
   const ac=await browser.newContext(),assessor=await ac.newPage();
   await login(assessor,baseUrl,fixture.credentials.assessor,"assessor");
   await assessor.goto(baseUrl+"/assessor/interviews",{waitUntil:"domcontentloaded"});
   const row=assessor.getByRole("row").filter({has:assessor.getByText(fixture.requests.Alpha.caseId,{exact:true})});
   await row.getByLabel("Interview time (UTC)").fill(new Date(Date.now()+60000).toISOString().slice(0,16));
   await row.getByRole("button",{name:"Schedule",exact:true}).click();
   await row.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor();
   await worker.reload({waitUntil:"domcontentloaded"});
   await worker.getByLabel("Describe the issue").fill("x");
   await worker.locator("form").filter({has:worker.getByRole("button",{name:"Record technical issue",exact:true})}).evaluate(node=>{node.noValidate=true;node.requestSubmit();});
   await worker.getByRole("alert").filter({hasText:/Check the technical issue/}).waitFor({timeout:15000});
   await worker.getByLabel("Describe the issue").fill("Camera cannot connect before readiness");
   await worker.getByRole("button",{name:"Record technical issue",exact:true}).click();
   await worker.getByText("technical hold",{exact:true}).first().waitFor();
   await worker.getByRole("status").filter({hasText:"Technical issue recorded."}).waitFor();
   assert.equal(await worker.getByRole("alert").filter({hasText:/Check the technical issue/}).count(),0);
   await worker.reload({waitUntil:"domcontentloaded"});
   await worker.getByText("technical hold",{exact:true}).first().waitFor();
   assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await wc.close();await ac.close();
  });
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const row=(await db.query("SELECT status FROM interview_runtime_sessions WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0];assert.equal(row.status,"TECHNICAL_HOLD");
   assert.equal((await db.query("SELECT technical_issue FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0].technical_issue,"Camera cannot connect before readiness");
  }finally{await db.close()}
 }finally{await browser.close();await fixture.cleanup()}
});
