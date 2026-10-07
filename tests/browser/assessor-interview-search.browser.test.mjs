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



import { assessorInterviewSearchFixture } from "../helpers/assessor-interview-search-fixture.mjs";
test("Assessor header search reaches the assigned console and rejects revoked sessions", {timeout:180000}, async()=>{
 const fixture=await assessorInterviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 let savedStorage;
 try{
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const context=await browser.newContext(),page=await context.newPage();
    await login(page,baseUrl,fixture.credentials.assessor,"assessor");
    for(const width of [1440,390,320]){
     await page.setViewportSize({width,height:1000});
     await page.goto(baseUrl+"/assessor/dashboard",{waitUntil:"domcontentloaded"});
     const header=page.locator("header.portal-header"),search=header.getByRole("group",{name:"Interview assignment search",exact:true});
     assert.equal(await search.count(),1,"Assessor header search missing");
     const control=await search.locator("summary").boundingBox();assert.ok(control&&control.x>=0&&control.x+control.width<=width&&control.height>=44);
     assert.ok(await header.evaluate(el=>el.scrollWidth<=el.clientWidth));
     await search.locator("summary").focus();await page.keyboard.press("Enter");
     const input=search.getByLabel("Search interview assignments",{exact:true});
     await input.fill(fixture.requests.Alpha.interviewRequestId);
     const box=await input.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width);
     await input.press("Enter");
     await page.waitForURL(url=>url.pathname==="/assessor/interviews"&&url.searchParams.get("q")===fixture.requests.Alpha.interviewRequestId);
     await page.getByText("1 matching interview",{exact:true}).waitFor();
     assert.equal(await page.locator("tbody tr").count(),1);
     await page.getByRole("link",{name:"Open interview console",exact:true}).click();
     await page.waitForURL("**/assessor/interviews/"+fixture.requests.Alpha.interviewRequestId);
     await page.getByRole("heading",{name:"Case "+fixture.requests.Alpha.caseId,exact:true}).waitFor();
    }
    const foreignResponse=await page.goto(baseUrl+"/assessor/interviews/"+fixture.requests.ForeignAlpha.interviewRequestId,{waitUntil:"domcontentloaded"});
    // Next documents 200 for streamed not-found responses and404 otherwise.
    assert.ok([200,404].includes(foreignResponse.status()),"Unassigned console must use the unavailable boundary without a server error");
    await page.getByRole("heading",{name:"The requested record could not be shown.",exact:true}).waitFor();
    assert.equal(await page.getByRole("heading",{name:"Case "+fixture.requests.ForeignAlpha.caseId,exact:true}).count(),0);
    const missingResponse=await page.goto(baseUrl+"/assessor/interviews/interview_request_missing",{waitUntil:"domcontentloaded"});
    assert.ok([200,404].includes(missingResponse.status()));
    await page.getByRole("heading",{name:"The requested record could not be shown.",exact:true}).waitFor();
    for(const q of [fixture.requests.ForeignAlpha.interviewRequestId,"' OR 1=1 --","%"]){
     await page.goto(baseUrl+"/assessor/interviews?"+new URLSearchParams({q,assessorAccountId:"search_foreign_assessor"}),{waitUntil:"domcontentloaded"});
     await page.getByText("No interview assignments match your search.",{exact:true}).waitFor();
     assert.equal(await page.locator("tbody tr").count(),0);
    }
    await page.goto(baseUrl+"/assessor/interviews?q=",{waitUntil:"domcontentloaded"});
    await page.getByRole("heading",{name:"Scheduled interviews",exact:true}).waitFor();
    assert.equal(await page.locator("tbody tr").count(),2);
    await page.reload({waitUntil:"domcontentloaded"});assert.equal(await page.locator("tbody tr").count(),2);
    savedStorage=await context.storageState();
    console.log("ACTUAL_ASSESSOR_SEARCH actual request/assignment producers -> 3width keyboard search -> assigned console; foreign assignment excluded, forged scope ignored, literal queries, empty and refresh");
   }finally{await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{await db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='Assessor search test' WHERE account_id=$1 AND revoked_at IS NULL",[fixture.credentials.assessor.accountId,new Date().toISOString()]);}finally{await db.close();}
  const denied=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    for(const path of ["/assessor/interviews?q=assigned","/assessor/interviews/"+fixture.requests.Alpha.interviewRequestId]){
     const context=await browser.newContext({storageState:savedStorage}),page=await context.newPage();
     await page.goto(baseUrl+path,{waitUntil:"domcontentloaded"});
     await page.waitForURL(url=>url.pathname==="/assessor/login");
     await context.close();
    }
    console.log("ACTUAL_ASSESSOR_SEARCH_REVOKED_SESSION direct results denied");
   }finally{await browser.close();}
  }});assert.equal(denied.requestedSignal,"SMOKE_COMPLETE");
 }finally{await fixture.cleanup();}
});
