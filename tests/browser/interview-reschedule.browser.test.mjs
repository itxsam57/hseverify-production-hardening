import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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




import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {formatDateTime}=loadWorkerRegistrationTs("src/lib/format.ts");
test("Assessor reschedules through the real form and Worker sees the persisted appointment", {timeout:240000}, async()=>{
 const fixture=await assessorInterviewSearchFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 const firstTime=new Date(Date.now()+86400000).toISOString().slice(0,16),nextTime=new Date(Date.now()+172800000).toISOString().slice(0,16),reason="Worker requested another appointment";
 const run=async(probe)=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",projectRoot:process.cwd(),environment:fixture.environment,probe});
 try{
  await run(async()=>{
   await login(page,baseUrl,fixture.credentials.assessor,"assessor");
   await page.goto(baseUrl+"/assessor/interviews",{waitUntil:"domcontentloaded"});
   const row=page.getByRole("row").filter({has:page.getByText(fixture.requests.Alpha.caseId,{exact:true})});
   await row.getByLabel("Interview time (UTC)").fill(firstTime);
   await row.getByRole("button",{name:"Schedule",exact:true}).click();
   await row.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor();
   await row.getByText(firstTime+":00.000Z",{exact:true}).waitFor();
  });
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM platform_outbox_jobs WHERE job_type IN ('notification.interview.scheduled','email.interview.scheduled')")).rows[0].n,6);await db.close();
  await run(async()=>{
   await page.goto(baseUrl+"/assessor/interviews",{waitUntil:"domcontentloaded"});
   const row=page.getByRole("row").filter({has:page.getByText(fixture.requests.Alpha.caseId,{exact:true})}),form=row.locator("form").filter({has:page.getByRole("button",{name:"Reschedule interview",exact:true})});
   await form.getByLabel("Interview time (UTC)").fill(nextTime);
   await form.getByRole("button",{name:"Reschedule interview",exact:true}).click();
   assert.equal(await form.evaluate(node=>node.checkValidity()),false);
   await form.evaluate(node=>{node.noValidate=true;node.requestSubmit();});
   await page.getByText(/Check the interview time and provide a reschedule reason/).waitFor();
   await form.getByLabel("Interview time (UTC)").fill(nextTime);
   await form.getByLabel("Reschedule reason").fill(reason);
   await form.getByRole("button",{name:"Reschedule interview",exact:true}).click();
   await row.getByText(nextTime+":00.000Z",{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
  const persisted=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  const request=(await persisted.query("SELECT scheduled_at,reschedule_reason FROM interview_requests WHERE interview_request_id=$1",[fixture.requests.Alpha.interviewRequestId])).rows[0];
  assert.equal(new Date(request.scheduled_at).toISOString(),nextTime+":00.000Z");assert.equal(request.reschedule_reason,reason);
  assert.equal((await persisted.query("SELECT count(*)::int AS n FROM platform_outbox_jobs WHERE job_type IN ('notification.interview.scheduled','email.interview.scheduled')")).rows[0].n,12);await persisted.close();
  await run(async()=>{
   const worker=await browser.newContext(),workerPage=await worker.newPage();await login(workerPage,baseUrl,fixture.credentials.worker,"worker");
   await workerPage.goto(baseUrl+"/worker/interviews/"+fixture.requests.Alpha.interviewRequestId,{waitUntil:"domcontentloaded"});
   await workerPage.getByText(formatDateTime(nextTime+":00.000Z"),{exact:true}).waitFor();
   await worker.close();
  });
  const built=spawnSync(process.execPath,['scripts/build-outbox-worker.mjs'],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  const controlled=await mkdtemp(join(tmpdir(),'hse-reschedule-notice-'));
  try{
   const callsPath=join(controlled,'calls.jsonl'),preload=join(controlled,'transport.mjs');
   await writeFile(preload,'import {appendFileSync} from "node:fs";globalThis.fetch=async(url,options)=>{if(String(url)!=="https://api.resend.com/emails")throw new Error("Unexpected controlled endpoint");const message=JSON.parse(options.body);appendFileSync('+JSON.stringify(callsPath)+',JSON.stringify({text:message.text,key:options.headers["Idempotency-Key"]})+"\\n");return new Response(JSON.stringify({id:"controlled-reschedule-"+options.headers["Idempotency-Key"]}),{status:200});};');
   const env={...fixture.environment,HSE_OTP_EMAIL_API_KEY:'controlled-reschedule-key',HSE_OTP_EMAIL_FROM:'notifications@example.test',HSE_PUBLIC_BASE_URL:'https://hse.example.test'};
   for(let i=0;i<12;i++){const result=spawnSync(process.execPath,['--import',preload,'scripts/run-outbox-worker.mjs','--once'],{env,encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"status":"succeeded"/);}
   const calls=(await readFile(callsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(calls.length,3);assert.equal(new Set(calls.map(x=>x.key)).size,3);for(const call of calls)assert.equal(call.text.includes(reason),false);
   let companyHref;
   const projection=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);try{
    const notices=(await projection.query("SELECT * FROM platform_notifications WHERE notification_type='interview.scheduled'")).rows;assert.equal(notices.length,3);
    const event=(await projection.query('SELECT schedule_event_id FROM interview_requests WHERE interview_request_id=$1',[fixture.requests.Alpha.interviewRequestId])).rows[0].schedule_event_id;
    for(const notice of notices)assert.equal(notice.metadata.eventRef,event);
    companyHref='/company/assurance-orders/'+notices.find(x=>x.recipient_role==='company').target_reference;
    const states=(await projection.query("SELECT status,delivered_at FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'")).rows;assert.equal(states.filter(x=>x.status==='suppressed').length,3);assert.equal(states.filter(x=>x.status==='sent').length,3);for(const state of states)assert.equal(state.delivered_at,null);
   }finally{await projection.close();}
   await run(async()=>{
    for(const role of ['assessor','worker','company']){
     const roleContext=role==='assessor'?context:await browser.newContext({viewport:{width:390,height:844}}),rolePage=role==='assessor'?page:await roleContext.newPage();
     try{
      if(role!=='assessor')await login(rolePage,baseUrl,fixture.credentials[role],role);
      await rolePage.goto(baseUrl+'/'+role+'/notifications',{waitUntil:'domcontentloaded'});
      const notice=rolePage.locator('.notification-center-item').filter({has:rolePage.getByRole('heading',{name:'Interview scheduled',exact:true})});assert.equal(await notice.count(),1);assert.equal((await notice.innerText()).includes(reason),false);
      await notice.getByRole('button',{name:'Open',exact:true}).click();await rolePage.waitForURL(baseUrl+(role==='company'?companyHref:'/'+role+'/interviews/'+fixture.requests.Alpha.interviewRequestId));
      if(role==='assessor')await rolePage.getByText(nextTime+':00.000Z',{exact:true}).waitFor();
      else if(role==='worker')await rolePage.getByText(formatDateTime(nextTime+':00.000Z'),{exact:true}).waitFor();
      else await rolePage.locator('tr[id="'+fixture.requests.Alpha.caseId+'"]').getByText(formatDateTime(nextTime+':00.000Z'),{exact:true}).waitFor();
      if(role!=='assessor')assert.equal((await rolePage.locator('body').innerText()).includes(reason),false);
      assert.equal(await rolePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     }finally{if(role!=='assessor')await roleContext.close();}
    }
   });
   console.log('ACTUAL_RESCHEDULE_NOTICE_BROWSER real reschedule -> actual compiled CLI12 -> old6suppressed/new3notices+3acceptedemails -> Worker Assessor Company Open links show revised time and no private reason;390px nooverflow');
  }finally{await rm(controlled,{recursive:true,force:true});}
  console.log("ACTUAL_RESCHEDULE_BROWSER initial schedule -> required reason -> persisted new time/reason and12 durable jobs -> Worker private record refresh; 390px no overflow");
 }finally{await browser.close();await fixture.cleanup();}
});
