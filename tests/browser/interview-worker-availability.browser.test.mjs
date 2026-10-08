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




test("Worker availability survives refresh and controls Assessor scheduling through actual forms",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),worker=await browser.newContext({viewport:{width:390,height:844}}),page=await worker.newPage();
 const availableFrom=new Date(Date.now()+86400000).toISOString().slice(0,16),availableUntil=new Date(Date.now()+172800000).toISOString().slice(0,16),outside=new Date(Date.now()+3*86400000).toISOString().slice(0,16);
 const run=probe=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe});
 try{
 await run(async()=>{
  await login(page,baseUrl,fixture.credentials.worker,"worker");
  await page.goto(baseUrl+"/worker/interviews/"+fixture.requests.Alpha.interviewRequestId,{waitUntil:"domcontentloaded"});
  await page.getByLabel("Available from (UTC)").waitFor({timeout:5000});
  await page.getByLabel("Available from (UTC)").fill(availableFrom);await page.getByLabel("Available until (UTC)").fill(availableUntil);
  await page.getByRole("button",{name:"Save interview availability",exact:true}).click();
  await page.reload({waitUntil:"domcontentloaded"});assert.equal(await page.getByLabel("Available from (UTC)").inputValue(),availableFrom);assert.equal(await page.getByLabel("Available until (UTC)").inputValue(),availableUntil);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const assessor=await browser.newContext(),assessorPage=await assessor.newPage();await login(assessorPage,baseUrl,fixture.credentials.assessor,"assessor");await assessorPage.goto(baseUrl+"/assessor/interviews",{waitUntil:"domcontentloaded"});
  const row=assessorPage.getByRole("row").filter({has:assessorPage.getByText(fixture.requests.Alpha.caseId,{exact:true})});
  await row.getByText(availableFrom+":00.000Z",{exact:false}).waitFor();
  await row.getByLabel("Interview time (UTC)").fill(outside);await row.getByRole("button",{name:"Schedule",exact:true}).click();
  await assessorPage.getByText(/Check the interview time/).waitFor();
  await row.getByLabel("Interview time (UTC)").fill(availableFrom);await row.getByRole("button",{name:"Schedule",exact:true}).click();await row.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor();
  await page.reload({waitUntil:"domcontentloaded"});await page.getByText(/An appointment is scheduled/).waitFor();assert.equal(await page.getByRole("button",{name:"Save interview availability",exact:true}).count(),1);
  await assessor.close();
 });
 const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);const saved=(await db.query("SELECT scheduled_at,candidate_available_from,candidate_available_until FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0];assert.equal(new Date(saved.scheduled_at).toISOString(),availableFrom+":00.000Z");assert.equal(new Date(saved.candidate_available_until).toISOString(),availableUntil+":00.000Z");await db.close();
 console.log("ACTUAL_AVAILABILITY_BROWSER Worker authenticated form -> persisted UTC window -> refresh -> Assessor sees window -> outside rejection -> inside actual appointment -> Worker retains current appointment; 390px no overflow");
 }finally{await browser.close();await fixture.cleanup();}
});
