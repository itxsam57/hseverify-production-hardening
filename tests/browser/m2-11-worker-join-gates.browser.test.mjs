import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){let bits="",bytes=[];for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(c).toString(2).padStart(5,"0");for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");}
function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));});});}
async function login(page,base,credential,role){await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});await page.getByLabel("Email address").fill(credential.email);await page.getByLabel("Password").fill(credential.password);if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});}
test("M2.11.06 real Worker 390px cannot join unscheduled or future; in-window entry then actual device readiness gates independent Assessor admission",{timeout:240000},async()=>{
 const f=await assessorInterviewSearchFixture();let stage="seed";let extra;
 try{
  const db=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
  try{extra=await new InterviewSchedulingService(db).requestAdditionalInterview({tenantId:f.credentials.company.tenantId,caseId:f.requests.Alpha.caseId,workerAccountId:f.credentials.worker.accountId,requestedAt:new Date().toISOString()});}
  finally{await db.close();}
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/worker/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
   try{
    const wc=await browser.newContext({viewport:{width:390,height:844},permissions:["camera","microphone"]});
    const ac=await browser.newContext({viewport:{width:1280,height:900}});
    const worker=await wc.newPage(),assessor=await ac.newPage();
    await login(worker,base,f.credentials.worker,"worker");await login(assessor,base,f.credentials.assessor,"assessor");
    stage="unassigned worker";
    await worker.goto(base+"/worker/interviews/"+extra.interviewRequestId);
    assert.equal(await worker.getByRole("button",{name:"Enter waiting room"}).count(),0);
    stage="schedule future";
    await assessor.goto(base+"/assessor/interviews");
    async function schedule(request,minutes){
      const row=assessor.getByRole("row").filter({has:assessor.locator('input[name="interviewRequestId"][value="'+request.interviewRequestId+'"]')});
      await row.getByLabel("Interview time (UTC)").fill(new Date(Date.now()+minutes*60000).toISOString().slice(0,16));
      await row.getByRole("button",{name:"Schedule",exact:true}).click();
      await row.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor({timeout:20000});
    }
    await schedule(f.requests.Alpha,65);
    await worker.goto(base+"/worker/interviews/"+f.requests.Alpha.interviewRequestId);
    assert.equal(await worker.getByRole("button",{name:"Enter waiting room"}).count(),0);
    assert.match(await worker.locator("body").innerText(),/waiting room opens 30 minutes/i);
    stage="schedule in-window";
    await schedule(f.requests.Beta,15);
    await worker.goto(base+"/worker/interviews/"+f.requests.Beta.interviewRequestId);
    await worker.getByRole("button",{name:"Enter waiting room"}).waitFor();
    assert.equal(await worker.getByRole("button",{name:"Ready for Interview"}).count(),0);
    stage="enter waiting room";
    await worker.getByRole("button",{name:"Enter waiting room"}).click();
    await worker.getByRole("button",{name:"Ready for Interview"}).waitFor({timeout:20000});
    assert.equal(await worker.getByRole("button",{name:"Ready for Interview"}).isDisabled(),true);
    stage="assessor claim without readiness";
    await assessor.goto(base+"/assessor/interviews/"+f.requests.Beta.interviewRequestId);
    assert.equal(await assessor.getByRole("button",{name:"Admit ready Worker"}).count(),0);
    await assessor.getByRole("button",{name:"Claim interview"}).click();
    await assessor.reload();
    assert.equal(await assessor.getByRole("button",{name:"Admit ready Worker"}).count(),0);
    stage="real device check";
    await worker.getByRole("button",{name:"Check camera, microphone & connection"}).click();
    await worker.getByText("Camera, microphone and connection checks passed.",{exact:true}).waitFor({timeout:20000});
    assert.equal(await worker.getByRole("button",{name:"Ready for Interview"}).isDisabled(),true,"Cannot mark Ready without identity confirmation");
    await worker.getByLabel(/I confirm I am the Worker assigned/i).check();
    await worker.getByRole("button",{name:"Ready for Interview"}).click();
    await worker.getByText(/Ready checks and required consent are recorded/).waitFor({timeout:20000});
    stage="admission after ready";
    await assessor.reload();
    await assessor.getByRole("button",{name:"Admit ready Worker"}).click();
    await assessor.reload();
    assert.match(await assessor.locator("body").innerText(),/ADMITTED/);
    assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await wc.close();await ac.close();
   }finally{await browser.close();}
  }});
  const check=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
  try{
   assert.equal((await check.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[extra.interviewRequestId])).rows[0].status,"REQUESTED");
   assert.equal((await check.query("SELECT count(*)::int n FROM interview_runtime_sessions WHERE interview_request_id=$1",[extra.interviewRequestId])).rows[0].n,0);
   assert.equal((await check.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[f.requests.Alpha.interviewRequestId])).rows[0].status,"ASSIGNED");
   assert.equal((await check.query("SELECT count(*)::int n FROM interview_runtime_sessions WHERE interview_request_id=$1",[f.requests.Alpha.interviewRequestId])).rows[0].n,0);
   const runtime=(await check.query("SELECT status,claimed_at,worker_ready_at,admitted_at FROM interview_runtime_sessions WHERE interview_request_id=$1",[f.requests.Beta.interviewRequestId])).rows[0];
   assert.equal(runtime.status,"ADMITTED");assert.ok(runtime.claimed_at);assert.ok(runtime.worker_ready_at);assert.ok(runtime.admitted_at);
  }finally{await check.close();}
  console.log("ACTUAL_M21106_BROWSER authentic Worker 390px and Assessor real form, future and unassigned hidden with zero runtime, fake Chromium media readiness + identity, admission requires Ready, persisted ADMITTED.");
 }catch(error){console.error("M21106_STAGE "+stage);throw error;}finally{await f.cleanup();}
});