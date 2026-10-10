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

import { accommodationDeliveryFixture } from "../helpers/accommodation-delivery-fixture.mjs";
test("Worker browser consumes the approved timer and fixed break without question or review access",{timeout:180000},async()=>{
 const c=await accommodationDeliveryFixture({seed:"browserbreak"}),port=await freePort(),baseUrl="http://127.0.0.1:"+port,browser=await chromium.launch({headless:true}),attemptId=c.begun.attempt.attemptId;
 let closed=false;
 try{
  await c.db.close();closed=true;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:{...c.fixture.environment,HSE_RUNTIME_PROJECT_ROOT:c.fixture.directory},probe:async()=>{
   const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(5000);
   await login(page,baseUrl,c.fixture.credentials.worker,"worker");
   await page.goto(baseUrl+"/worker/assessments/"+attemptId,{waitUntil:"domcontentloaded"});
   await page.getByRole("timer",{name:"Assessment time remaining"}).waitFor();
   await page.getByRole("heading",{name:"Question 1",exact:true}).waitFor();
   await page.getByRole("radio").first().check();
   await page.getByRole("button",{name:"Take approved break",exact:true}).click();
   await page.getByRole("heading",{name:"Approved break",exact:true}).waitFor();
   assert.equal(await page.getByRole("heading",{name:"Question 1",exact:true}).count(),0);
   assert.equal(await page.getByRole("radio").count(),0);
   const first=await page.getByTestId("approved-break-end").textContent();
   await page.reload({waitUntil:"domcontentloaded"});
   await page.getByRole("heading",{name:"Approved break",exact:true}).waitFor();
   assert.equal(await page.getByTestId("approved-break-end").textContent(),first);
   assert.equal(await page.getByRole("button",{name:"Emergency exit",exact:true}).count(),1);
   await page.screenshot({path:".autopilot/artifacts/approved-break-browser.png",fullPage:true});
   await page.getByRole("heading",{name:"Question 1",exact:true}).waitFor({timeout:70000});
   assert.ok(await page.getByRole("radio").first().isChecked(),"saved draft must survive the real fixed rest");
   await page.getByRole("button",{name:"Take approved break",exact:true}).click();
   await page.getByRole("heading",{name:"Approved break",exact:true}).waitFor();
   await page.getByRole("button",{name:"Emergency exit",exact:true}).click();
   await page.waitForURL("**/worker/available-assessments");
   await context.close();
  }});
  const db=await PGlite.create(c.fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   assert.equal(Number((await db.query("SELECT time_multiplier FROM assessment_attempt_time_policies WHERE attempt_id=$1",[attemptId])).rows[0].time_multiplier),1.5);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM assessment_accommodation_breaks WHERE attempt_id=$1",[attemptId])).rows[0].n,2);
  assert.equal((await db.query("SELECT status FROM assessment_attempts WHERE attempt_id=$1",[attemptId])).rows[0].status,"INTERRUPTED");
  }finally{await db.close();}
  console.log("ACTUAL_APPROVED_BREAK_BROWSER immutable 1.5 policy -> Worker timer -> finite server pause -> questions absent -> reload preserves receipt; emergency exit remains operative.");
 }finally{await browser.close();if(!closed)await c.db.close();await c.fixture.cleanup();}
});
