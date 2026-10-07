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

import {spawnSync} from "node:child_process";
test("Real scheduling action delivers in-app notices through the built worker to three authorized record links",{timeout:180000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),assessor=await browser.newContext({viewport:{width:390,height:844}});
 const assessorPage=await assessor.newPage(),selected=new Date(Date.now()+86400000).toISOString().slice(0,16);
 let expectedCompanyHref,workerNotificationId;
 const server=probe=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",projectRoot:process.cwd(),environment:fixture.environment,probe});
 try{
  assert.equal((await server(async()=>{
   await login(assessorPage,baseUrl,fixture.credentials.assessor,"assessor");
   await assessorPage.goto(baseUrl+"/assessor/interviews?"+new URLSearchParams({q:fixture.requests.Alpha.interviewRequestId}),{waitUntil:"domcontentloaded"});
   const row=assessorPage.locator("tbody tr");assert.equal(await row.count(),1);
   await row.getByLabel("Interview time (UTC)",{exact:true}).fill(selected);
   await row.getByRole("button",{name:"Schedule",exact:true}).click();
   await row.locator('input[name="scheduledAt"]').waitFor({state:"detached"});
  })).requestedSignal,"SMOKE_COMPLETE");
  // The real CLI owns and closes its offline database between server processes.
  for(let i=0;i<3;i++){
   const result=spawnSync(process.execPath,["scripts/run-outbox-worker.mjs","--once"],{env:fixture.environment,encoding:"utf8"});
   assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"status":"succeeded"/);
  }
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const notices=(await db.query("SELECT * FROM platform_notifications WHERE notification_type='interview.scheduled'")).rows;
   assert.equal(notices.length,3);workerNotificationId=notices.find(n=>n.recipient_role==="worker").notification_id;
   const company=notices.find(n=>n.recipient_role==="company");
   expectedCompanyHref="/company/assurance-orders/"+company.target_reference;
   assert.equal(new Date((await db.query("SELECT scheduled_at FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0].scheduled_at).toISOString(),selected+":00.000Z");
  }finally{await db.close();}
  assert.equal((await server(async()=>{
   for(const role of ["assessor","worker","company"]){
    const context=role==="assessor"?assessor:await browser.newContext({viewport:{width:390,height:844}});
    const page=role==="assessor"?assessorPage:await context.newPage();
    if(role!=="assessor")await login(page,baseUrl,fixture.credentials[role],role);
    await page.goto(baseUrl+"/"+role+"/notifications",{waitUntil:"domcontentloaded"});
    const notice=page.locator(".notification-center-item").filter({has:page.getByRole("heading",{name:"Interview scheduled",exact:true})});
    assert.equal(await notice.count(),1);assert.match(await notice.innerText(),/Unread/);
    const expected=role==="company"?expectedCompanyHref:"/"+role+"/interviews/"+fixture.requests.Alpha.interviewRequestId;
    await notice.getByRole("button",{name:"Open",exact:true}).focus();await page.keyboard.press("Enter");
    await page.waitForURL(baseUrl+expected,{timeout:20000});
    if(role==="worker")await page.getByRole("heading",{name:"Structured competency interview",exact:true}).waitFor();
    if(role==="company")assert.equal(await page.locator("tr[id="+fixture.requests.Alpha.caseId+"]").count(),1);
    if(role==="assessor")await page.getByRole("heading",{name:"Case "+fixture.requests.Alpha.caseId,exact:true}).waitFor();
    await page.goto(baseUrl+"/"+role+"/notifications",{waitUntil:"domcontentloaded"});
    assert.match(await page.locator(".notification-center-item").innerText(),/Read/);
   }
   const foreign=await browser.newContext(),page=await foreign.newPage();
   await login(page,baseUrl,{email:"search.foreign@example.test",password:fixture.credentials.worker.password},"worker");
   await page.goto(baseUrl+"/worker/notifications",{waitUntil:"domcontentloaded"});
   assert.equal(await page.getByRole("heading",{name:"Interview scheduled",exact:true}).count(),0);
   // Existing test-only fixture creates an owned form used to submit an adversarial foreign notification ID.
   await page.getByRole("button",{name:"Create persisted test notification",exact:true}).click();
   await page.waitForURL("**/worker/notifications?notice=fixture-ready");
   const owned=page.locator(".notification-center-item");
   await owned.locator('form:has(button:text-is("Open")) input[name="notificationId"]').evaluate((input,value)=>{input.value=value;},workerNotificationId);
   await owned.getByRole("button",{name:"Open",exact:true}).click();
   await page.waitForURL("**/worker/notifications?notice=unavailable");
   await page.getByText("That notification is unavailable in this portal or you no longer have access to it.",{exact:true}).waitFor();
   console.log("ACTUAL_INTERVIEW_NOTIFICATION_BROWSER scheduleaction -> builtCLI3 -> authorized Assessor/Worker/Company record, unread/read persistence, unrelated Worker receives none and forged notification ID denied");
  })).requestedSignal,"SMOKE_COMPLETE");
  const verified=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   assert.equal(Number((await verified.query("SELECT count(*) AS total FROM platform_notifications WHERE notification_type='interview.scheduled' AND read_at IS NOT NULL")).rows[0].total),3);
   assert.equal(Number((await verified.query("SELECT count(*) AS total FROM platform_audit_events WHERE action_key='notification.deep_link.denied'")).rows[0].total),1);
  }finally{await verified.close();}
 }finally{await browser.close();await fixture.cleanup();}
});
