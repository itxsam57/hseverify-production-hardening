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
test("M2.12.02 real mobile Assessor approved follow-up creates new question version, survives reload, Worker cannot access console",{timeout:210000},async()=>{
 const x=await policyInterview({start:false});let closed=false,stage="initial";
 try{
  const original=x.set,requestId=x.request.interviewRequestId,baseId=x.request.caseId;
  await x.database.close();closed=true;
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/assessor/login",projectRoot:process.cwd(),environment:x.fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const assessor=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const worker=await(await browser.newContext()).newPage();
    await login(assessor,base,x.fixture.credentials.assessor,"assessor");
    await login(worker,base,x.fixture.credentials.worker,"worker");
    stage="original v1";
    const consoleUrl=base+"/assessor/interviews/"+requestId;
    await assessor.goto(consoleUrl);
    await assessor.getByRole("tab",{name:"Questions",exact:true}).click();
    const panel=assessor.getByRole("tabpanel",{name:"Questions"});
    await panel.getByText("Structured interview playbook",{exact:true}).waitFor();
    assert.match(await panel.innerText(),/version 1/);
    assert.match(await panel.innerText(),/Explain how you isolate the supply and verify the controls/);
    assert.match(await panel.innerText(),/Explain the stop-work criteria/);
    assert.equal(await panel.getByRole("combobox",{name:"Approved follow-up question"}).count(),1);
    stage="submit actual approved follow-up";
    await panel.getByRole("combobox",{name:"Approved follow-up question"}).selectOption("follow");
    const submitted=assessor.waitForResponse(response=>response.request().method()==="POST" && Boolean(response.request().headers()["next-action"]),{timeout:20000});
    await panel.getByRole("button",{name:"Add versioned follow-up"}).click();
    assert.equal((await submitted).status(),200,"Follow-up Server Action must complete without 500");
    await assessor.getByRole("tab",{name:"Questions"}).click();
    const updated=assessor.getByRole("tabpanel",{name:"Questions"});
    await updated.getByText(/version 2/).waitFor({timeout:20000});
    assert.match(await updated.innerText(),/Clarify which isolation checks you repeat before restarting/);
    assert.equal(await updated.getByRole("button",{name:"Add versioned follow-up"}).count(),0,"No approved followup reusable after being added");
    stage="reload version";
    await assessor.reload({waitUntil:"networkidle"});
    const tab=assessor.getByRole("tab",{name:"Questions",exact:true});
    await tab.waitFor({timeout:20000});
    await tab.click();
    if((await tab.getAttribute("aria-selected"))!=="true")await tab.click();
    await assessor.waitForFunction(()=>Array.from(document.querySelectorAll('[role="tab"]')).some(x=>x.textContent?.trim()==="Questions"&&x.getAttribute("aria-selected")==="true"),null,{timeout:20000});
    assert.match(await assessor.getByRole("tabpanel",{name:"Questions"}).innerText(),/version 2/);
    assert.equal(await assessor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    stage="Worker cannot open Assessor console";
    const workerVisit=await worker.goto(consoleUrl);
    assert.ok(workerVisit.status()!==200||new URL(worker.url()).pathname!=="/assessor/interviews/"+requestId);
    assert.ok(!(await worker.locator("body").innerText()).includes(original.questions[0].prompt));
   }finally{await browser.close();}
  }});
  const db=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const rows=(await db.query("SELECT question_set_id,version_no,source_context_json,questions_json FROM interview_question_sets WHERE interview_request_id=$1 ORDER BY version_no",[requestId])).rows;
   assert.equal(rows.length,2);assert.deepEqual(rows.map(v=>v.version_no),[1,2]);
   assert.equal(rows[0].question_set_id,original.questionSetId);
   assert.deepEqual(rows[0].questions_json,original.questions);
   assert.deepEqual(rows[1].questions_json.slice(0,-1),rows[0].questions_json);
   assert.equal(rows[1].questions_json.at(-1).templateId,"follow");
   assert.equal(rows[1].source_context_json.policyVersionId,x.published);
   assert.equal(rows[1].source_context_json.caseId,baseId);
  }finally{await db.close();}
  console.log("ACTUAL_M21202_BROWSER TOTP Assessor mobile 390px real Questions tab and approved follow-up form -> version 2 persisted across reload; Worker blocked; old v1 intact in reopened migrated DB.");
 }catch(e){console.error("M21202_STAGE "+stage);throw e;}finally{if(!closed)await x.database.close();await x.fixture.cleanup();}
});