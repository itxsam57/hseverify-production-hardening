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



import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";

test("Worker header search reaches owned application results across viewports and denies revoked sessions", {timeout:180000}, async () => {
 const fixture=await workerAssessmentSearchFixture(), port=await freePort(), baseUrl="http://127.0.0.1:"+port;
 let savedStorage;
 try {
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try {
    const context=await browser.newContext(),page=await context.newPage();
    await login(page,baseUrl,fixture.credentials.worker,"worker");
    for(const width of [1440,390,320]){
     await page.setViewportSize({width,height:1000});
     await page.goto(baseUrl+"/worker/dashboard",{waitUntil:"domcontentloaded"});
     const header=page.locator("header.portal-header"),search=header.getByRole("group",{name:"Assessment application search",exact:true});
     assert.equal(await search.count(),1,"Worker header application search is missing");
     const control=await search.locator("summary").boundingBox();
     assert.ok(control && control.x>=0 && control.x+control.width<=width && control.height>=44);
     assert.ok(await header.evaluate(el=>el.scrollWidth<=el.clientWidth),"Header controls overflow");
     await search.locator("summary").focus();await page.keyboard.press("Enter");
     const input=search.getByLabel("Search assessment applications",{exact:true});
     await input.fill("Alpha");
     const box=await input.boundingBox();assert.ok(box && box.x>=0 && box.x+box.width<=width);
     await input.press("Enter");
     await page.waitForURL(url=>url.pathname==="/worker/assessment-applications"&&url.searchParams.get("q")==="Alpha");
     const history=page.getByRole("region",{name:"Application and funding history",exact:true});
     await history.getByText("1 matching application",{exact:true}).waitFor();
     assert.equal(await history.locator("article").count(),1);
     assert.equal(await history.getByRole("heading",{name:"Alpha assessment",exact:true}).count(),1);
     await page.reload({waitUntil:"domcontentloaded"});
     await history.getByText("1 matching application",{exact:true}).waitFor();
    }
    const history=page.getByRole("region",{name:"Application and funding history",exact:true});
    for(const q of ["No matching record","' OR 1=1 --","%"]){
     await page.goto(baseUrl+"/worker/assessment-applications?"+new URLSearchParams({q,accountId:"search_foreign_worker"}),{waitUntil:"domcontentloaded"});
     await history.getByText("No assessment applications match your search.",{exact:true}).waitFor();
     assert.equal(await history.locator("article").count(),0);
    }
    await page.goto(baseUrl+"/worker/assessment-applications?"+new URLSearchParams({q:"Alpha",accountId:"search_foreign_worker"}),{waitUntil:"domcontentloaded"});
    await history.getByText("1 matching application",{exact:true}).waitFor();
    await page.goto(baseUrl+"/worker/assessment-applications?q=",{waitUntil:"domcontentloaded"});
    await history.getByRole("heading",{name:"Beta assessment",exact:true}).waitFor();
    assert.equal(await history.locator("article").count(),2);
    savedStorage=await context.storageState();
    console.log("ACTUAL_WORKER_SEARCH 320/390/1440 keyboard submit, owned results, refresh, matching foreign record excluded, forged scope ignored, literal SQL/wildcard and empty query");
   } finally {await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try {await db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='Worker search regression' WHERE account_id=$1 AND revoked_at IS NULL",[fixture.credentials.worker.accountId,new Date().toISOString()]);} finally {await db.close();}
  const denied=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try {
    const context=await browser.newContext({storageState:savedStorage}),page=await context.newPage();
    await page.goto(baseUrl+"/worker/assessment-applications?q=Alpha",{waitUntil:"domcontentloaded"});
    await page.waitForURL(url=>url.pathname==="/worker/login");
    assert.equal(await page.getByRole("heading",{name:"Alpha assessment",exact:true}).count(),0);
    console.log("ACTUAL_WORKER_SEARCH_REVOKED_SESSION persisted revocation denies result route");
   } finally {await browser.close();}
  }});assert.equal(denied.requestedSignal,"SMOKE_COMPLETE");
 } finally {await fixture.cleanup();}
});
