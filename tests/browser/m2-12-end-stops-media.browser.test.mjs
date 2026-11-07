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
test("M2.12.07 Assessor End stops own media and remote Worker camera/mic without Worker reload; final submission locks and advances case",{timeout:240000},async()=>{
 const x=await policyInterview({policy:{...configuredPolicy(),minimumActiveSeconds:0},start:true});
 const id=x.request.interviewRequestId;let closed=false,stage="initial";
 try{
  await x.database.close();closed=true;
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/assessor/login",projectRoot:process.cwd(),environment:x.fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
   try{
    const ac=await browser.newContext({viewport:{width:390,height:844},permissions:["camera","microphone"]});
    const wc=await browser.newContext({viewport:{width:390,height:844},permissions:["camera","microphone"]});
    const assessor=await ac.newPage(),worker=await wc.newPage();
    await login(assessor,base,x.fixture.credentials.assessor,"assessor");await login(worker,base,x.fixture.credentials.worker,"worker");
    await assessor.goto(base+"/assessor/interviews/"+id);await worker.goto(base+"/worker/interviews/"+id);
    for(const page of [assessor,worker])await page.getByLabel(/I allow this browser to use my camera and microphone/i).check();
    stage="two peer media connected";
    await assessor.getByRole("button",{name:"Enable camera & microphone"}).click();
    await worker.getByRole("button",{name:"Enable camera & microphone"}).click();
    await assessor.getByText("Live — encrypted peer connection",{exact:true}).waitFor({timeout:30000});
    await worker.getByText("Live — encrypted peer connection",{exact:true}).waitFor({timeout:30000});
    for(const page of [assessor,worker]) {
      const tracks=await page.evaluate(()=>{
        const stream=document.querySelector(".interview-media-panel video")?.srcObject;
        if(!(stream instanceof MediaStream))return [];
        window.__m21207Tracks=stream.getTracks();
        return window.__m21207Tracks.map(t=>({kind:t.kind,state:t.readyState}));
      });
      assert.deepEqual(tracks.map(t=>t.kind).sort(),["audio","video"]);
      assert.ok(tracks.every(t=>t.state==="live"));
    }
    stage="actual score and submitted draft before ending";
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    await assessor.getByLabel("Notes",{exact:true}).fill("Evidence from live camera and audio examined before ending.");
    for(const name of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"])await assessor.getByLabel(name,{exact:true}).fill("3");
    await assessor.getByLabel("Scorecard comments",{exact:true}).fill("Candidate demonstrated safe isolation and effective escalation to supervisors.");
    const coverage=assessor.locator('input[name="coveredQuestionId"]');assert.ok(await coverage.count()>=2);
    for(let i=0;i<await coverage.count();i++)await coverage.nth(i).check();
    await assessor.locator('select[name="safety:live-work"]').selectOption("NOT_OBSERVED");
    const saved=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await assessor.getByRole("button",{name:"Save draft",exact:true}).click();assert.equal((await saved).status(),200);
    stage="End while Worker remains in live page";
    await assessor.getByRole("button",{name:"End interview",exact:true}).click();
    await assessor.locator(".status-pill").getByText("ENDED",{exact:true}).waitFor({timeout:25000});
    await worker.getByText("Interview media ended",{exact:true}).waitFor({timeout:15000});
    const workerTracks=await worker.evaluate(()=>window.__m21207Tracks?.map(t=>({kind:t.kind,state:t.readyState}))??[]);
    assert.deepEqual(workerTracks.map(t=>t.state),["ended","ended"],"Worker tracks must stop without navigation after remote End");
    const ownTracks=await assessor.evaluate(()=>window.__m21207Tracks?.map(t=>({kind:t.kind,state:t.readyState}))??[]);
    assert.deepEqual(ownTracks.map(t=>t.state),["ended","ended"],"Assessor device tracks must also stop");
    assert.equal(await worker.getByRole("button",{name:"Enable camera & microphone"}).isDisabled(),true,"Remote closed Worker must not restart media on stale page");
    for(const page of [assessor,worker]){
      const get=await page.evaluate(async id=>{const r=await fetch("/api/interviews/"+id+"/media",{cache:"no-store"});return r.status;},id);
      assert.equal(get,409,"Post-End GET media polling must reject from both signed-in roles");
      const post=await page.evaluate(async id=>{const r=await fetch("/api/interviews/"+id+"/media",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:"leave",payload:{connectionId:"closed_connection_12345678901234"}})});return r.status;},id);
      assert.equal(post,409,"Post-End signaling mutation must reject from both signed-in roles");
    }
    stage="actual final PASS recommendation advances case";
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    await assessor.getByLabel("Recommendation",{exact:true}).selectOption("PASS");
    const posting=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await assessor.getByRole("button",{name:"Submit final recommendation",exact:true}).click();assert.equal((await posting).status(),200);
    await assessor.getByText("Final interview record submitted and locked.",{exact:true}).waitFor({timeout:20000});
    assert.equal(await assessor.getByRole("button",{name:"Enable camera & microphone"}).isDisabled(),true);
    assert.equal(await assessor.getByRole("button",{name:"Submit final recommendation",exact:true}).count(),0);
    assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await ac.close();await wc.close();
   }finally{await browser.close();}
  }});
  const db=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   assert.equal((await db.query("SELECT status FROM interview_runtime_sessions WHERE interview_request_id=$1",[id])).rows[0].status,"ENDED");
   assert.equal((await db.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[id])).rows[0].status,"COMPLETED");
   assert.equal((await db.query("SELECT submitted,recommendation FROM interview_console_drafts WHERE interview_request_id=$1",[id])).rows[0].recommendation,"PASS");
   assert.equal((await db.query("SELECT count(*)::int n FROM interview_recommendation_events WHERE interview_request_id=$1",[id])).rows[0].n,1);
   assert.equal((await db.query("SELECT count(*)::int n FROM interview_runtime_events WHERE interview_session_id=$1 AND event_type='ENDED'",[x.session.interviewSessionId])).rows[0].n,1);
  }finally{await db.close();}
  console.log("ACTUAL_M21207_BROWSER real independent Assessor/Worker WebRTC fake devices live; real End stopped original 4 device tracks without Worker navigation, closed both signed-in GET and POST signaling, Worker cannot restart; final PASS locks and advances.");
 }catch(e){console.error("M21207_STAGE "+stage);throw e;}finally{if(!closed)await x.database.close();await x.fixture.cleanup();}
});