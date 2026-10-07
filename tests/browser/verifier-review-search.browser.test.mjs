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



import { verifierReviewSearchFixture } from "../helpers/verifier-review-search-fixture.mjs";
test("Verifier search finds queued tasks beyond the first page and opens only authorized review records", {timeout:180000},async()=>{
 const fixture=await verifierReviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;let savedStorage;
 try{
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/verifier/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const context=await browser.newContext(),page=await context.newPage();
    await login(page,baseUrl,fixture.credentials.verifier,"verifier");
    for(const width of [1440,390,320]){
     await page.setViewportSize({width,height:1000});await page.goto(baseUrl+"/verifier/dashboard",{waitUntil:"domcontentloaded"});
     const header=page.locator("header.portal-header"),search=header.getByRole("group",{name:"Evidence review search",exact:true});
     assert.equal(await search.count(),1,"Verifier header search missing");
     const control=await search.locator("summary").boundingBox();assert.ok(control&&control.x>=0&&control.x+control.width<=width&&control.height>=44);
     assert.ok(await header.evaluate(el=>el.scrollWidth<=el.clientWidth));
     await search.locator("summary").focus();await page.keyboard.press("Enter");
     const input=search.getByLabel("Search evidence reviews",{exact:true});await input.fill("SEARCH-ALPHA");
     const box=await input.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width);await input.press("Enter");
     await page.waitForURL(url=>url.pathname==="/verifier/reviews"&&url.searchParams.get("q")==="SEARCH-ALPHA");
     await page.getByText("Showing 1 matching review task",{exact:true}).waitFor();
     assert.equal(await page.locator("tbody tr").count(),1);await page.getByRole("link",{name:"Review",exact:true}).click();
     await page.waitForURL("**/verifier/reviews/"+fixture.alpha);await page.getByRole("heading",{name:"Evidence review",exact:true}).waitFor();
     await page.getByText("SEARCH-ALPHA-VERSION",{exact:true}).waitFor();
     if(width===1440){
      await page.getByRole("button",{name:"Claim review",exact:true}).click();
      await page.getByText("ASSIGNED",{exact:true}).waitFor();
     }
    }
    const foreign=await page.goto(baseUrl+"/verifier/reviews/"+fixture.foreign,{waitUntil:"domcontentloaded"});
    assert.ok([200,404].includes(foreign.status()));await page.getByRole("heading",{name:"The requested record could not be shown.",exact:true}).waitFor();
    for(const q of ["SEARCH-ALPHA-FOREIGN","' OR 1=1 --","%"]){
     await page.goto(baseUrl+"/verifier/reviews?"+new URLSearchParams({q,accountId:"search_foreign_verifier"}),{waitUntil:"domcontentloaded"});
     await page.getByText("No review tasks match your search.",{exact:true}).waitFor();assert.equal(await page.locator("tbody tr").count(),0);
    }
    await page.goto(baseUrl+"/verifier/reviews?"+new URLSearchParams({q:"SEARCH-BETA",accountId:"search_foreign_verifier"}),{waitUntil:"domcontentloaded"});
    await page.getByText("Showing 1 matching review task",{exact:true}).waitFor();assert.equal(await page.locator("tbody tr").count(),1);
    await page.reload({waitUntil:"domcontentloaded"});await page.getByText("Showing 1 matching review task",{exact:true}).waitFor();
    await page.goto(baseUrl+"/verifier/reviews?q=",{waitUntil:"domcontentloaded"});await page.getByRole("heading",{name:"Evidence review queue",exact:true}).waitFor();assert.equal(await page.locator("tbody tr").count(),250);
    savedStorage=await context.storageState();
    console.log("ACTUAL_VERIFIER_SEARCH 3widths keyboard, match beyond250, real review claim retained, foreign assigned exclusion, direct unavailable boundary, forgedscope, literal queries and refresh");
   }finally{await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const claim=(await db.query("SELECT task_status,assigned_verifier_account_id,claimed_at FROM evidence_review_tasks WHERE task_id=$1",[fixture.alpha])).rows[0];
   assert.equal(claim.task_status,"ASSIGNED");assert.equal(claim.assigned_verifier_account_id,fixture.credentials.verifier.accountId);assert.ok(claim.claimed_at);
   await db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='Verifier search test' WHERE account_id=$1 AND revoked_at IS NULL",[fixture.credentials.verifier.accountId,new Date().toISOString()]);
  }finally{await db.close();}
  const denied=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/verifier/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{for(const path of ["/verifier/reviews?q=SEARCH-ALPHA","/verifier/reviews/"+fixture.alpha]){
    const context=await browser.newContext({storageState:savedStorage}),page=await context.newPage();await page.goto(baseUrl+path,{waitUntil:"domcontentloaded"});await page.waitForURL(url=>url.pathname==="/verifier/login");await context.close();
   }}finally{await browser.close();}
  }});assert.equal(denied.requestedSignal,"SMOKE_COMPLETE");
 }finally{await fixture.cleanup();}
});
