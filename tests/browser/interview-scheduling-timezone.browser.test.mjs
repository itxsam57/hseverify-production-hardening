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
test("Assessor UTC schedule is independent of server and browser timezones",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const selected=new Date(Date.now()+86400000).toISOString().slice(0,16),expected=selected+":00.000Z";let displayed;
 try{
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",projectRoot:process.cwd(),environment:{...fixture.environment,TZ:"America/New_York"},probe:async()=>{
   const browser=await chromium.launch({headless:true});try{
    const context=await browser.newContext({timezoneId:"Asia/Karachi"}),page=await context.newPage();await login(page,baseUrl,fixture.credentials.assessor,"assessor");
    await page.goto(baseUrl+"/assessor/interviews?"+new URLSearchParams({q:fixture.requests.Alpha.interviewRequestId}),{waitUntil:"domcontentloaded"});
    const row=page.locator("tbody tr");assert.equal(await row.count(),1);
    await row.getByLabel("Interview time (UTC)",{exact:true}).fill(selected);await row.getByRole("button",{name:"Schedule",exact:true}).click();
    await row.locator('input[name="scheduledAt"]').waitFor({state:"detached"});displayed=await row.innerText();
   }finally{await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);try{
   const stored=(await db.query("SELECT scheduled_at,timezone FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0];
   const actual=new Date(stored.scheduled_at).toISOString();
   console.log("ACTUAL_UTC_SCHEDULE_BROWSER",JSON.stringify({selected,expected,actual,recordTimezone:stored.timezone,displayedIncludesActual:displayed.includes(actual)}));
   assert.equal(stored.timezone,"UTC");
   assert.ok(displayed.includes(expected),"Schedule table must display the stored UTC instant");
   assert.equal(actual,expected,"An interview in UTC must not be interpreted in the server's New York timezone");
  }finally{await db.close();}
 }finally{await fixture.cleanup();}
});
