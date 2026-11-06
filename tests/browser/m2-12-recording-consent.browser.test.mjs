import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {policyInterview,configuredPolicy} from "../helpers/interview-policy-fixture.mjs";
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){let bits="",bytes=[];for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(c).toString(2).padStart(5,"0");for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");}
function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));});});}
async function login(page,base,credential,role){await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});await page.getByLabel("Email address").fill(credential.email);await page.getByLabel("Password").fill(credential.password);if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});}
test("M2.12.08 real Worker required audio consent and two-party browser audio recording final chunk is retained privately on End",{timeout:200000},async()=>{
 const x=await policyInterview({policy:{...configuredPolicy(),minimumActiveSeconds:0,recording:{policy:"AUDIO_ONLY",retentionDays:60,consentRequired:true}},start:false});
 let closed=false,stage="initial",id=x.request.interviewRequestId;
 try{
  await x.database.close();closed=true;
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/worker/login",projectRoot:process.cwd(),environment:x.fixture.environment,probe:async()=>{
    const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
    try{
     const wc=await browser.newContext({viewport:{width:390,height:844},permissions:["camera","microphone"]});
     const ac=await browser.newContext({viewport:{width:390,height:844},permissions:["camera","microphone"]});
     const worker=await wc.newPage(),assessor=await ac.newPage();
     await login(worker,base,x.fixture.credentials.worker,"worker");await login(assessor,base,x.fixture.credentials.assessor,"assessor");
     const workerUrl=base+"/worker/interviews/"+id,assessorUrl=base+"/assessor/interviews/"+id;
     stage="Worker waiting room and explicit consent";
     await worker.goto(workerUrl);
     await worker.getByText("Recording policy",{exact:true}).waitFor();
     await worker.getByRole("button",{name:"Enter waiting room",exact:true}).click();
     await worker.getByRole("button",{name:"Check camera, microphone & connection"}).click();
     await worker.getByText("Camera, microphone and connection checks passed.",{exact:true}).waitFor({timeout:10000});
     await worker.getByLabel("I confirm I am the Worker assigned to this interview.").check();
     const consent=worker.getByLabel(/I consent to the interview recording required/);
     assert.equal(await consent.count(),1);
     assert.equal(await worker.getByRole("button",{name:"Ready for Interview"}).isDisabled(),true);
     assert.match(await consent.locator("xpath=..").innerText(),/audio only/i);
     await consent.check();
     await worker.getByRole("button",{name:"Ready for Interview"}).click();
     await worker.getByText("Ready checks and required consent are recorded.",{exact:false}).waitFor({timeout:18000});
     stage="Assessor starts actual recorded runtime";
     await assessor.goto(assessorUrl);
     await assessor.getByRole("button",{name:"Admit ready Worker",exact:true}).click();
     await assessor.locator(".status-pill").getByText("ADMITTED",{exact:true}).waitFor({timeout:20000});
     await assessor.getByRole("button",{name:"Start interview",exact:true}).click();
     await assessor.locator(".status-pill").getByText("ACTIVE",{exact:true}).waitFor({timeout:20000});
     await worker.reload({waitUntil:"domcontentloaded"});
     await assessor.getByLabel(/I allow this browser to use my camera and microphone/i).check();
     await worker.getByLabel(/I allow this browser to use my camera and microphone/i).check();
     stage="WebRTC audio recorder starts for consented case";
     await assessor.getByRole("button",{name:"Enable camera & microphone"}).click();
     await worker.getByRole("button",{name:"Enable camera & microphone"}).click();
     await assessor.getByText("Live — encrypted peer connection",{exact:true}).waitFor({timeout:30000});
     await worker.getByText("Live — encrypted peer connection",{exact:true}).waitFor({timeout:30000});
     await assessor.getByText(/Audio recording active/).waitFor({timeout:15000});
     const rec=await assessor.evaluate(()=>[...document.querySelectorAll(".interview-media-panel video")].map(v=>v.srcObject instanceof MediaStream ? v.srcObject.getAudioTracks().length : 0));
     assert.equal(rec[0],1);
     stage="End releases recording and uploads final captured segment";
     await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
     for(const label of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"])await assessor.getByLabel(label,{exact:true}).fill("3");
     await assessor.getByLabel("Scorecard comments",{exact:true}).fill("Safe evidence verified during consented recorded audio interview.");
     const cover=assessor.locator('input[name="coveredQuestionId"]');assert.ok(await cover.count()>=2);
     for(let i=0;i<await cover.count();i++)await cover.nth(i).check();
     await assessor.locator('select[name="safety:live-work"]').selectOption("NOT_OBSERVED");
     const saving=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
     await assessor.getByRole("button",{name:"Save draft"}).click();assert.equal((await saving).status(),200);
     const finalSegment=assessor.waitForResponse(r=>r.request().method()==="POST"&&r.url().endsWith("/api/interviews/"+id+"/recording"),{timeout:30000});
     await assessor.getByRole("button",{name:"End interview",exact:true}).click();
     assert.equal((await finalSegment).status(),201,"Final real browser MediaRecorder segment must upload successfully when End stops recording");
     await assessor.locator(".status-pill").getByText("ENDED",{exact:true}).waitFor({timeout:20000});
     await worker.getByText("Interview media ended",{exact:true}).waitFor({timeout:12000});
     await worker.reload({waitUntil:"domcontentloaded"});
     assert.equal(await worker.getByRole("button",{name:"Enable camera & microphone"}).isDisabled(),true);
     assert.equal(await assessor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     await wc.close();await ac.close();
    }finally{await browser.close();}
  }});
  const db=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   assert.equal((await db.query("SELECT recording_policy,recording_consent_required,recording_consented_at FROM interview_requests WHERE interview_request_id=$1",[id])).rows[0].recording_policy,"AUDIO_ONLY");
   const row=(await db.query("SELECT source,status,retention_until,tenant_id,case_id,started_at,ended_at FROM recording_assets WHERE interview_request_id=$1 ORDER BY created_at DESC LIMIT 1",[id])).rows[0];
   assert.ok(row,"AUDIO_ONLY policy must persist a real MediaRecorder segment on End");
   assert.equal(row.source,"AUDIO_ONLY");assert.equal(row.status,"AVAILABLE");
   assert.equal(row.tenant_id,x.fixture.credentials.company.tenantId);
   assert.ok(new Date(row.retention_until).getTime()>Date.now()+59*86400000);
   assert.ok(new Date(row.started_at)<=new Date(row.ended_at));
  }finally{await db.close();}
  console.log("ACTUAL_M21208_BROWSER required Worker consent, actual Assessor audio recording with fake Chromium mic, final segment private storage and 60-day retention.");
 }catch(e){console.error("M21208_STAGE "+stage);throw e;}finally{if(!closed)await x.database.close();await x.fixture.cleanup();}
});
