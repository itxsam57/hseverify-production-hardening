import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {policyInterview} from "../helpers/interview-policy-fixture.mjs";
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){let bits="",bytes=[];for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(c).toString(2).padStart(5,"0");for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");}
function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));});});}
async function login(page,base,credential,role){await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});await page.getByLabel("Email address").fill(credential.email);await page.getByLabel("Password").fill(credential.password);if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});}
test("M2.12.03 independent Worker/Assessor live media disconnect and reconnect preserves unsaved then persisted draft notes and partial scores across tabs and reload",{timeout:240000},async()=>{
 const x=await policyInterview({start:true});let closed=false,stage="setup";
 const requestId=x.request.interviewRequestId,firstNote="PRE-RECONNECT: verify isolation locks and stop-work control before resuming.",secondNote="POST-RECONNECT: confirmed live resumption and revised hazard observation.";
 try{
  await x.database.close();closed=true;
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/assessor/login",projectRoot:process.cwd(),environment:x.fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
   try{
    const ac=await browser.newContext({viewport:{width:390,height:844},permissions:["camera","microphone"]});
    const wc=await browser.newContext({viewport:{width:1280,height:900},permissions:["camera","microphone"]});
    const assessor=await ac.newPage(),worker=await wc.newPage();
    await login(assessor,base,x.fixture.credentials.assessor,"assessor");
    await login(worker,base,x.fixture.credentials.worker,"worker");
    const assessorUrl=base+"/assessor/interviews/"+requestId,workerUrl=base+"/worker/interviews/"+requestId;
    await assessor.goto(assessorUrl);await worker.goto(workerUrl);
    stage="enter unsaved draft";
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    await assessor.getByLabel("Notes",{exact:true}).fill(firstNote);
    await assessor.getByLabel("Technical knowledge",{exact:true}).fill("2");
    await assessor.getByLabel("Scorecard comments",{exact:true}).fill("Partial scored observation remains pending across the connection.");
    await assessor.getByRole("tab",{name:"Questions",exact:true}).click();
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),firstNote);
    assert.equal(await assessor.getByLabel("Technical knowledge",{exact:true}).inputValue(),"2");
    stage="first true WebRTC connection";
    for(const page of [assessor,worker]){
     await page.getByText(/I allow this browser to use my camera and microphone/).locator('xpath=preceding-sibling::input[@type="checkbox"]').check();
    }
    await assessor.getByRole("button",{name:"Enable camera & microphone"}).click();
    await worker.getByRole("button",{name:"Enable camera & microphone"}).click();
    await assessor.getByText("Live — encrypted peer connection",{exact:true}).waitFor({timeout:30000});
    await worker.getByText("Live — encrypted peer connection",{exact:true}).waitFor({timeout:30000});
    stage="disconnection preserves unsaved";
    await assessor.getByRole("button",{name:"Leave media"}).click();
    await assessor.getByText("Not connected",{exact:true}).waitFor();
    await worker.getByRole("button",{name:"Leave media"}).click();
    await worker.getByText("Not connected",{exact:true}).waitFor();
    assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),firstNote);
    assert.equal(await assessor.getByLabel("Technical knowledge",{exact:true}).inputValue(),"2");
    stage="second real WebRTC connection";
    await assessor.getByRole("button",{name:"Enable camera & microphone"}).click();
    await worker.getByRole("button",{name:"Enable camera & microphone"}).click();
    await assessor.getByText("Live — encrypted peer connection",{exact:true}).waitFor({timeout:30000});
    await worker.getByText("Live — encrypted peer connection",{exact:true}).waitFor({timeout:30000});
    assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),firstNote);
    stage="save draft during second media session";
    const saving=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await assessor.getByRole("button",{name:"Save draft",exact:true}).click();
    assert.equal((await saving).status(),200);
    await assessor.waitForFunction(value=>document.querySelector('textarea[name="notes"]')?.value===value,firstNote,{timeout:20000});
    stage="reload persisted notes and scores";
    await assessor.reload({waitUntil:"networkidle"});
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),firstNote);
    assert.equal(await assessor.getByLabel("Technical knowledge",{exact:true}).inputValue(),"2");
    assert.equal(await assessor.getByLabel("Scorecard comments",{exact:true}).inputValue(),"Partial scored observation remains pending across the connection.");
    stage="save revised draft after reconnect and reload";
    await assessor.getByLabel("Notes",{exact:true}).fill(secondNote);
    await assessor.getByLabel("Technical knowledge",{exact:true}).fill("4");
    const secondSave=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await assessor.getByRole("button",{name:"Save draft",exact:true}).click();
    assert.equal((await secondSave).status(),200);
    await assessor.reload({waitUntil:"networkidle"});
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),secondNote);
    assert.equal(await assessor.getByLabel("Technical knowledge",{exact:true}).inputValue(),"4");
    assert.equal(await assessor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await worker.getByLabel("Notes",{exact:true}).count(),0);
    await ac.close();await wc.close();
   }finally{await browser.close();}
  }});
  const db=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const drafts=(await db.query("SELECT interview_session_id,notes,scorecard,submitted FROM interview_console_drafts WHERE interview_request_id=$1",[requestId])).rows;
   assert.equal(drafts.length,1,"Media reconnect and repeated draft saves must retain one current session");
   assert.equal(drafts[0].interview_session_id,x.session.interviewSessionId);
   assert.equal(drafts[0].notes.at(-1).content,secondNote);
   assert.equal(drafts[0].scorecard.technicalKnowledge,4);
   assert.equal(drafts[0].submitted,false);
   assert.equal((await db.query("SELECT status FROM interview_runtime_sessions WHERE interview_request_id=$1",[requestId])).rows[0].status,"ACTIVE");
  }finally{await db.close();}
  console.log("ACTUAL_M21203_BROWSER independent MFA Assessor/Worker fake-media WebRTC connected twice after leave, unsaved notes/partial scores retained, saved drafts survived reload/reconnect/second edit, one persisted ACTIVE session.");
 }catch(e){console.error("M21203_STAGE "+stage);throw e;}finally{if(!closed)await x.database.close();await x.fixture.cleanup();}
});