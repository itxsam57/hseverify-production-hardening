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
test("M2.12.05 390px real Assessor incomplete saved scorecard End denied, pending recommendation submission denied, complete submission advances exactly once",{timeout:240000},async()=>{
 const x=await policyInterview({policy:{...configuredPolicy(),minimumActiveSeconds:0},start:true}),id=x.request.interviewRequestId;
 let closed=false,stage="initial";
 try{
  await x.database.close();closed=true;
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/assessor/login",projectRoot:process.cwd(),environment:x.fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const assessor=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const worker=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    await login(assessor,base,x.fixture.credentials.assessor,"assessor");await login(worker,base,x.fixture.credentials.worker,"worker");
    const url=base+"/assessor/interviews/"+id;
    await assessor.goto(url);
    stage="End without saved scores";
    await assessor.getByRole("button",{name:"End interview",exact:true}).click();
    await assessor.waitForURL("**/assessor/interviews/"+id+"?consoleError=policy*",{timeout:20000});
    assert.match(await assessor.getByRole("alert").filter({hasText:/scorecard|dimension/i}).innerText(),/scorecard|complete|dimension/i);
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    assert.equal(await assessor.getByRole("button",{name:"Submit final recommendation",exact:true}).isDisabled(),true);
    stage="partial draft save and End denial";
    await assessor.getByLabel("Technical knowledge",{exact:true}).fill("2");
    const draftPost=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await assessor.getByRole("button",{name:"Save draft",exact:true}).click();
    assert.equal((await draftPost).status(),200);
    await assessor.getByRole("button",{name:"End interview",exact:true}).click();
    await assessor.waitForURL("**/assessor/interviews/"+id+"?consoleError=policy*",{timeout:20000});
    assert.equal(await assessor.getByRole("button",{name:"Submit final recommendation",exact:true}).isDisabled(),true);
    stage="full scorecard without recommendation";
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    for(const label of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"])await assessor.getByLabel(label,{exact:true}).fill("3");
    await assessor.getByLabel("Scorecard comments",{exact:true}).fill("Safe isolation verified; candidate understands critical stop-work procedures.");
    const coverage=assessor.locator('input[name="coveredQuestionId"]');
    assert.ok((await coverage.count())>=2);
    for(let i=0;i<await coverage.count();i++)await coverage.nth(i).check();
    await assessor.locator('select[name="safety:live-work"]').selectOption("NOT_OBSERVED");
    await assessor.getByLabel("Recommendation",{exact:true}).selectOption("");
    const fullDraft=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await assessor.getByRole("button",{name:"Save draft",exact:true}).click();
    assert.equal((await fullDraft).status(),200);
    stage="complete End";
    await assessor.getByRole("button",{name:"End interview",exact:true}).click();
    await assessor.locator(".status-pill").getByText("ENDED",{exact:true}).waitFor({timeout:20000});
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    assert.equal(await assessor.getByLabel("Recommendation",{exact:true}).inputValue(),"");
    const final=assessor.getByRole("button",{name:"Submit final recommendation",exact:true});
    assert.equal(await final.isDisabled(),false);
    assert.equal(await final.evaluate(btn=>btn.form.checkValidity()),false,"Pending recommendation must invalidate final browser form");
    stage="pending form no request";
    let requests=0;assessor.on("request",r=>{if(r.method()==="POST"&&Boolean(r.headers()["next-action"]))requests++;});
    await final.click();assert.equal(requests,0);
    stage="valid PASS";
    await assessor.getByLabel("Recommendation",{exact:true}).selectOption("PASS");
    const posted=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await final.click();assert.equal((await posted).status(),200);
    await assessor.getByText("Final interview record submitted and locked.",{exact:true}).waitFor({timeout:20000});
    assert.equal(await assessor.getByRole("button",{name:"Submit final recommendation",exact:true}).count(),0);
    await worker.goto(base+"/worker/interviews/"+id);
    assert.equal((await worker.locator("body").innerText()).includes("Safe isolation verified; candidate"),false);
    assert.equal(await assessor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }finally{await browser.close();}
  }});
  const db=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   assert.equal((await db.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[id])).rows[0].status,"COMPLETED");
   const draft=(await db.query("SELECT submitted,recommendation,scorecard FROM interview_console_drafts WHERE interview_request_id=$1",[id])).rows;
   assert.equal(draft.length,1);assert.equal(draft[0].submitted,true);assert.equal(draft[0].recommendation,"PASS");assert.equal(draft[0].scorecard.technicalKnowledge,3);
   assert.equal((await db.query("SELECT count(*)::int n FROM interview_runtime_events WHERE interview_session_id=$1 AND event_type='ENDED'",[x.session.interviewSessionId])).rows[0].n,1);
   assert.equal((await db.query("SELECT count(*)::int n FROM interview_recommendation_events WHERE interview_request_id=$1",[id])).rows[0].n,1);
   assert.notEqual((await db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[x.request.caseId])).rows[0].case_status,"Interview pending");
  }finally{await db.close();}
  console.log("ACTUAL_M21205_BROWSER real 390px Assessor incomplete End twice denied, full frozen scorecard End accepted, pending recommendation client blocked, valid PASS advances case with one audit and Worker does not receive private assessor text.");
 }catch(e){console.error("M21205_STAGE "+stage);throw e;}finally{if(!closed)await x.database.close();await x.fixture.cleanup();}
});