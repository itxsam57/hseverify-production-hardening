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



test("Worker retention inquiry reaches an actual Admin response and returns the persisted outcome to its owner",{timeout:120000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true});
 const answer="Assessment evidence and audit history follow their applicable retention policy; active appeal or legal holds prevent purge. This inquiry response does not delete records.";
 let requestId;
 try{
  await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[fixture.credentials.assessor.accountId]);await db.close();
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   const worker=await browser.newPage({viewport:{width:390,height:844}}),admin=await browser.newPage(),errors=[];
   worker.on("pageerror",error=>errors.push(error.message));admin.on("pageerror",error=>errors.push(error.message));
   await login(worker,baseUrl,fixture.credentials.worker,"worker");
   await worker.goto(baseUrl+"/worker/privacy",{waitUntil:"domcontentloaded"});
   await worker.getByLabel("Privacy request type").selectOption("retention_inquiry");
   await worker.getByRole("button",{name:"Submit privacy request",exact:true}).click();
   await worker.getByText("retention inquiry: OPEN",{exact:true}).waitFor();
   await login(admin,baseUrl,fixture.credentials.assessor,"admin");
   await admin.goto(baseUrl+"/admin/privacy",{waitUntil:"domcontentloaded"});
   const card=admin.locator("article").filter({hasText:"Request type: retention inquiry"});
   assert.equal(await card.count(),1);
   requestId=await card.locator('input[name="requestId"]').inputValue();
   await card.getByLabel("Request decision").selectOption("PROCESSING");
   await card.getByLabel("Request review reason").fill("Reviewing the record categories and any applicable active holds.");
   await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
   await card.getByText("Status: PROCESSING",{exact:true}).waitFor();
   await card.getByLabel("Request decision").selectOption("COMPLETED");
   await card.getByLabel("Request review reason").fill(answer);
   await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
   await card.getByText("Status: COMPLETED",{exact:true}).waitFor();
   assert.equal(await card.getByRole("button",{name:"Save privacy request decision",exact:true}).count(),0);
   await worker.goto(baseUrl+"/worker/privacy",{waitUntil:"domcontentloaded"});
   await worker.getByText("retention inquiry: COMPLETED",{exact:true}).waitFor();
   await worker.getByText("Review outcome: "+answer,{exact:true}).waitFor();
   await worker.reload();await worker.getByText("Review outcome: "+answer,{exact:true}).waitFor();
   assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await worker.goto(baseUrl+"/admin/privacy",{waitUntil:"domcontentloaded"});assert.equal(new URL(worker.url()).pathname,"/access-denied");
   assert.equal(errors.length,0);
  }});
  const check=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const row=(await check.query("SELECT worker_id,status,details,completed_at FROM privacy_requests WHERE request_id=$1",[requestId])).rows[0];
   assert.equal(row.worker_id,fixture.credentials.worker.accountId);assert.equal(row.status,"COMPLETED");assert.ok(row.completed_at);
   assert.equal(row.details.fulfilment.method,"retention_inquiry_response");
   const history=(await check.query("SELECT reviewer_account_id,from_status,to_status,reason FROM privacy_request_reviews WHERE request_id=$1 ORDER BY review_sequence",[requestId])).rows;
   assert.deepEqual(history.map(row=>[row.from_status,row.to_status]),[["OPEN","PROCESSING"],["PROCESSING","COMPLETED"]]);assert.equal(history[1].reason,answer);assert.ok(history.every(row=>row.reviewer_account_id===fixture.credentials.assessor.accountId));
  }finally{await check.close();}
  console.log("ACTUAL_RETENTION_INQUIRY_BROWSER Worker request -> Admin processing/response -> owned refreshed outcome/history; no purge or legal-policy certification");
 }finally{await browser.close();await fixture.cleanup();}
});
