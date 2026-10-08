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
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
test("Chosen reminder reaches three private records only when naturally due; a reschedule suppresses obsolete reminders",{timeout:240000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),assessor=await browser.newContext({viewport:{width:390,height:844},timezoneId:"Asia/Karachi"}),page=await assessor.newPage();
 const controlled=await mkdtemp(join(tmpdir(),"hse-reminder-")),callsPath=join(controlled,"calls.jsonl"),preload=join(controlled,"transport.mjs");
 let reminderAt,companyHref,betaReminderAt;
 const appointment=new Date(Date.now()+86400000).toISOString().slice(0,16),privateReason="Worker requested a private scheduling change";
 const errors=[];page.on("pageerror",error=>errors.push(error.message));
 const env={...fixture.environment,HSE_OTP_EMAIL_API_KEY:"controlled-reminder-key",HSE_OTP_EMAIL_FROM:"notifications@example.test",HSE_PUBLIC_BASE_URL:"https://hse.example.test"};
 const server=probe=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",projectRoot:process.cwd(),environment:{...fixture.environment,TZ:"America/New_York"},probe});
 const cli=()=>{const r=spawnSync(process.execPath,["--import",preload,"scripts/run-outbox-worker.mjs","--once"],{env,encoding:"utf8",timeout:20000});assert.equal(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout.trim());};
 const calls=async()=>JSON.parse("["+(await readFile(callsPath,"utf8")).trim().split("\n").filter(Boolean).join(",")+"]");
 const until=async value=>{const remaining=Date.parse(value)-Date.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining+100));};
 try{
  await writeFile(callsPath,"");
  await writeFile(preload,'import {appendFileSync} from "node:fs";globalThis.fetch=async(url,options)=>{if(String(url)!=="https://api.resend.com/emails")throw new Error("Unexpected controlled endpoint");const message=JSON.parse(options.body);appendFileSync('+JSON.stringify(callsPath)+',JSON.stringify({subject:message.subject,text:message.text,key:options.headers["Idempotency-Key"]})+"\\n");return new Response(JSON.stringify({id:"controlled-reminder-"+options.headers["Idempotency-Key"]}),{status:200});};');
  assert.equal((await server(async()=>{
   await login(page,baseUrl,fixture.credentials.assessor,"assessor");
   await page.goto(baseUrl+"/assessor/interviews?"+new URLSearchParams({q:fixture.requests.Alpha.interviewRequestId}),{waitUntil:"domcontentloaded"});
   const row=page.locator("tbody tr");assert.equal(await row.count(),1);
   reminderAt=new Date(Date.now()+45000).toISOString().slice(0,19)+".000Z";
   await row.getByLabel("Interview time (UTC)",{exact:true}).fill(appointment);
   await row.getByLabel("Reminder time (UTC)",{exact:true}).fill(reminderAt.slice(0,19));
   await row.getByRole("button",{name:"Schedule",exact:true}).click();
   await row.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor();
   await row.getByText("Reminder (UTC): "+reminderAt,{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  })).requestedSignal,"SMOKE_COMPLETE");
  const built=spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{encoding:"utf8"});assert.equal(built.status,0,built.stderr);
  for(let i=0;i<6;i++)assert.equal(cli().status,"succeeded");
  assert.ok(Date.now()<Date.parse(reminderAt),"The early check must actually run before the selected due time");
  assert.deepEqual(cli(),{processed:0,status:"idle"});
  let db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const stored=(await db.query("SELECT scheduled_at,reminder_at FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0];
   assert.equal(new Date(stored.scheduled_at).toISOString(),appointment+":00.000Z");
   assert.equal(new Date(stored.reminder_at).toISOString(),reminderAt);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_email_delivery_attempts attempts JOIN platform_email_deliveries deliveries USING(delivery_id) WHERE deliveries.delivery_type='interview.reminder'")).rows[0].n,0);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_notifications WHERE notification_type='interview.reminder'")).rows[0].n,0);
  }finally{await db.close();}
  assert.equal((await calls()).filter(call=>call.subject==="Interview reminder").length,0);
  await until(reminderAt);
  for(let i=0;i<6;i++)assert.equal(cli().status,"succeeded");
  assert.deepEqual(cli(),{processed:0,status:"idle"});
  db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const notices=(await db.query("SELECT * FROM platform_notifications WHERE notification_type='interview.reminder'")).rows;
   assert.equal(notices.length,3);assert.deepEqual(new Set(notices.map(n=>n.recipient_role)),new Set(["worker","assessor","company"]));
   companyHref="/company/assurance-orders/"+notices.find(n=>n.recipient_role==="company").target_reference;
   const delivered=(await db.query("SELECT status,delivered_at FROM platform_email_deliveries WHERE delivery_type='interview.reminder'")).rows;
   assert.equal(delivered.length,3);for(const delivery of delivered){assert.equal(delivery.status,"sent");assert.equal(delivery.delivered_at,null);}
  }finally{await db.close();}
  const dispatches=await calls(),reminders=dispatches.filter(call=>call.subject==="Interview reminder");assert.equal(reminders.length,3);assert.equal(new Set(reminders.map(call=>call.key)).size,3);
  assert.equal((await server(async()=>{
   for(const role of ["assessor","worker","company"]){
    const context=role==="assessor"?assessor:await browser.newContext({viewport:{width:390,height:844}}),recipient=role==="assessor"?page:await context.newPage();
    try{
     if(role!=="assessor")await login(recipient,baseUrl,fixture.credentials[role],role);
     await recipient.goto(baseUrl+"/"+role+"/notifications",{waitUntil:"domcontentloaded"});
     const notice=recipient.locator(".notification-center-item").filter({has:recipient.getByRole("heading",{name:"Interview reminder",exact:true})});
      await notice.waitFor({state:"visible"});assert.equal(await notice.count(),1);
     await notice.getByRole("button",{name:"Open",exact:true}).click();
     await recipient.waitForURL(baseUrl+(role==="company"?companyHref:"/"+role+"/interviews/"+fixture.requests.Alpha.interviewRequestId));
     assert.equal(await recipient.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }finally{if(role!=="assessor")await context.close();}
   }
   // Direct email links still require the intended signed-in role.
   for(const call of reminders){
    const href=new URL(call.text.match(/https:\/\/hse\.example\.test\/\S+$/)[0]),context=await browser.newContext(),anonymous=await context.newPage();
    try{await anonymous.goto(baseUrl+href.pathname+href.hash);assert.match(new URL(anonymous.url()).pathname,/\/(worker|assessor|company)\/login$/);}finally{await context.close();}
   }
   await page.goto(baseUrl+"/assessor/interviews?"+new URLSearchParams({q:fixture.requests.Beta.interviewRequestId}),{waitUntil:"domcontentloaded"});
   const row=page.locator("tbody tr");
   betaReminderAt=new Date(Date.now()+22000).toISOString().slice(0,19)+".000Z";
   await row.getByLabel("Interview time (UTC)",{exact:true}).fill(appointment);
   await row.getByLabel("Reminder time (UTC)",{exact:true}).fill(betaReminderAt.slice(0,19));
   await row.getByRole("button",{name:"Schedule",exact:true}).click();
   await row.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor();
   const betaNextAppointment=new Date(Date.now()+172800000).toISOString().slice(0,16);
   await row.getByLabel("Interview time (UTC)",{exact:true}).fill(betaNextAppointment);
   await row.getByLabel("Reminder time (UTC)",{exact:true}).fill("");
   await row.getByLabel("Reschedule reason",{exact:true}).fill(privateReason);
   await row.getByRole("button",{name:"Reschedule interview",exact:true}).click();
   await row.getByText(betaNextAppointment+":00.000Z",{exact:true}).waitFor();
  })).requestedSignal,"SMOKE_COMPLETE");
  for(let i=0;i<12;i++)assert.equal(cli().status,"succeeded");
  await until(betaReminderAt);
  for(let i=0;i<6;i++)assert.equal(cli().status,"succeeded");
  assert.deepEqual(cli(),{processed:0,status:"idle"});
  db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_notifications WHERE notification_type='interview.reminder'")).rows[0].n,3);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_email_deliveries WHERE delivery_type='interview.reminder' AND status='suppressed' AND delivered_at IS NULL")).rows[0].n,3);
   assert.equal((await db.query("SELECT reminder_at FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Beta.interviewRequestId])).rows[0].reminder_at,null);
  }finally{await db.close();}
  assert.equal((await calls()).filter(call=>call.subject==="Interview reminder").length,3);
  for(const call of await calls())assert.equal(call.text.includes(privateReason),false);
  assert.deepEqual(errors,[]);
  console.log("ACTUAL_REMINDER_BROWSER chosen UTC form -> no early attempts -> natural due actual compiled worker -> three accepted-not-delivered emails/notices -> authorized private links -> reschedule suppresses obsolete work;390px");
 }finally{await browser.close();await fixture.cleanup();await rm(controlled,{recursive:true,force:true});}
});
