import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {policyInterview} from "../helpers/interview-policy-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewAssignmentService}=loadWorkerRegistrationTs("src/lib/interview/interview-assignment-service.ts");
const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){let bits="",bytes=[];for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(c).toString(2).padStart(5,"0");for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");}
function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));});});}
async function login(page,base,credential,role){await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});await page.getByLabel("Email address").fill(credential.email);await page.getByLabel("Password").fill(credential.password);if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});}
test("M2.12.04 Assessor browser pause/resume technical hold recovery then replacement and Worker new schedule preserve archived score and notes",{timeout:235000},async()=>{
 const x=await policyInterview({start:true}),id=x.request.interviewRequestId,caseId=x.request.caseId,tenant=x.fixture.credentials.company.tenantId;
 const originalNote="First scored active observation before pause.",revisedNote="Rechecked controls after media interruption; original evidence must remain archived.";
 let closed=false,stage="calibration",replacementId;
 try{
  const matcher=new InterviewAssignmentService(x.database);
  await matcher.upsertProfile(x.admin,{assessorAccountId:x.principal.accountId,tradeScopes:["*"],qualificationScopes:["*"],languages:["*"],jurisdictions:["*"],riskLevels:["*"],availability:{},maxActiveInterviews:8,status:"ACTIVE"});
  await new StaffCalibrationService(Promise.resolve(x.database)).record(x.admin,{accountId:x.principal.accountId,role:"assessor",frameworkReference:"SEARCH-WORKER",status:"CURRENT",validFrom:new Date(),validUntil:new Date(Date.now()+86400000),note:"Real calibrated interview assessor for full browser recovery."});
  await x.database.close();closed=true;
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/assessor/login",projectRoot:process.cwd(),environment:x.fixture.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const assessor=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const worker=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    await login(assessor,base,x.fixture.credentials.assessor,"assessor");
    await login(worker,base,x.fixture.credentials.worker,"worker");
    const originalUrl=base+"/assessor/interviews/"+id;
    await assessor.goto(originalUrl);await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    stage="save first scored note";
    await assessor.getByLabel("Notes",{exact:true}).fill(originalNote);
    await assessor.getByLabel("Technical knowledge",{exact:true}).fill("2");
    await assessor.getByLabel("Scorecard comments",{exact:true}).fill("First partial observation.");
    const firstSave=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await assessor.getByRole("button",{name:"Save draft",exact:true}).click();
    assert.equal((await firstSave).status(),200);
    stage="pause";
    await assessor.getByLabel("Pause reason",{exact:true}).fill("Worker safety verification paused the live interview.");
    await assessor.getByRole("button",{name:"Pause interview",exact:true}).click();
    await assessor.locator(".status-pill").getByText("PAUSED",{exact:true}).waitFor({timeout:18000});
    await assessor.getByRole("tab",{name:"Notes and scoring"}).click();
    assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),originalNote);
    stage="resume from pause";
    await assessor.getByRole("button",{name:"Resume interview",exact:true}).click();
    await assessor.locator(".status-pill").getByText("ACTIVE",{exact:true}).waitFor();
    stage="technical hold then resume";
    await assessor.getByLabel("Technical issue",{exact:true}).fill("Mic and network connection interrupted; attempting reconnection.");
    await assessor.getByRole("button",{name:"Put on technical hold",exact:true}).click();
    await assessor.locator(".status-pill").getByText("TECHNICAL HOLD",{exact:true}).waitFor();
    await assessor.getByRole("button",{name:"Resume interview",exact:true}).click();
    await assessor.locator(".status-pill").getByText("ACTIVE",{exact:true}).waitFor();
    stage="save revised note";
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    await assessor.getByLabel("Notes",{exact:true}).fill(revisedNote);
    await assessor.getByLabel("Technical knowledge",{exact:true}).fill("4");
    const saving=assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"]),{timeout:20000});
    await assessor.getByRole("button",{name:"Save draft",exact:true}).click();
    assert.equal((await saving).status(),200);
    stage="second hold and replacement";
    await assessor.getByLabel("Technical issue",{exact:true}).fill("Repeated full network outage; unable to complete the interview.");
    await assessor.getByRole("button",{name:"Put on technical hold",exact:true}).click();
    await assessor.locator(".status-pill").getByText("TECHNICAL HOLD",{exact:true}).waitFor();
    await assessor.getByLabel("Replacement reason",{exact:true}).fill("Continued media interruption after prior recovery requires replacement.");
    await assessor.getByRole("button",{name:"Request replacement interview",exact:true}).click();
    await assessor.waitForURL("**/assessor/interviews?recoverySaved=yes",{timeout:20000});
    await assessor.goto(originalUrl,{waitUntil:"domcontentloaded"});
    await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    await assessor.getByText("Archived interview record.",{exact:false}).waitFor({timeout:20000});
    assert.equal(await assessor.getByLabel("Notes",{exact:true}).inputValue(),revisedNote);
    assert.equal(await assessor.getByLabel("Technical knowledge",{exact:true}).inputValue(),"4");
    assert.equal(await assessor.getByLabel("Notes",{exact:true}).isDisabled(),true);
    stage="worker sees replacement";
    await worker.goto(base+"/worker/interviews/"+id,{waitUntil:"domcontentloaded"});
    assert.equal((await worker.locator("body").innerText()).includes(revisedNote),false,"Worker cannot read private Assessor scorecard notes");
    await worker.getByRole("link",{name:"Open replacement interview",exact:true}).click();
    await worker.waitForURL(url=>url.pathname.startsWith("/worker/interviews/") && url.pathname.split("/").at(-1)!==id,{timeout:20000});
    replacementId=worker.url().split("/").at(-1);
    assert.notEqual(replacementId,id);
    stage="assessor schedules successor";
    await assessor.goto(base+"/assessor/interviews",{waitUntil:"domcontentloaded"});
    const row=assessor.getByRole("row").filter({has:assessor.locator('input[name="interviewRequestId"][value="'+replacementId+'"]')});
    await row.getByLabel("Interview time (UTC)").fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
    await row.getByRole("button",{name:"Schedule",exact:true}).click();
    await row.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor({timeout:20000});
    await worker.reload({waitUntil:"networkidle"});
    assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await assessor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }finally{await browser.close();}
  }});
  const db=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const old=(await db.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[id])).rows[0];
   assert.equal(old.status,"CANCELLED");
   const runtime=(await db.query("SELECT interview_session_id,status FROM interview_runtime_sessions WHERE interview_request_id=$1",[id])).rows[0];
   assert.equal(runtime.status,"TECHNICAL_HOLD");
   const draft=(await db.query("SELECT notes,scorecard,submitted FROM interview_console_drafts WHERE interview_request_id=$1",[id])).rows;
   assert.equal(draft.length,1);assert.equal(draft[0].notes.at(-1).content,revisedNote);assert.equal(draft[0].scorecard.technicalKnowledge,4);assert.equal(draft[0].submitted,false);
   const events=(await db.query("SELECT event_type,reason FROM interview_runtime_events WHERE interview_session_id=$1 ORDER BY occurred_at,event_id",[runtime.interview_session_id])).rows;
   assert.deepEqual(events.filter(e=>["PAUSED","RESUMED","TECHNICAL_ISSUE"].includes(e.event_type)).map(e=>e.event_type),["PAUSED","RESUMED","TECHNICAL_ISSUE","RESUMED","TECHNICAL_ISSUE"]);
   assert.equal((await db.query("SELECT count(*)::int n FROM interview_question_sets WHERE interview_request_id=$1",[id])).rows[0].n,1);
   assert.equal((await db.query("SELECT count(*)::int n FROM interview_console_drafts WHERE interview_request_id=$1",[replacementId])).rows[0].n,0);
   const replacement=(await db.query("SELECT scheduled_at,replaces_interview_request_id FROM interview_requests WHERE interview_request_id=$1",[replacementId])).rows[0];
   assert.ok(replacement.scheduled_at);assert.equal(replacement.replaces_interview_request_id,id);
   assert.equal((await db.query("SELECT interview_reference FROM assurance_cases WHERE case_id=$1 AND tenant_id=$2",[caseId,tenant])).rows[0].interview_reference,replacementId);
   assert.equal((await db.query("SELECT count(*)::int n FROM platform_audit_events WHERE action_key='interview.replacement.requested' AND target_reference=$1",[id])).rows[0].n,1);
  }finally{await db.close();}
  console.log("ACTUAL_M21204_BROWSER real signed-in Assessor mobile pause/resume/tech/resume/re-save/hold/request replacement, archived private note+scores and 5 runtime events retained, Worker sees separate scheduled appointment, owner case+audit correct.");
 }catch(e){console.error("M21204_STAGE "+stage);throw e;}finally{if(!closed)await x.database.close();await x.fixture.cleanup();}
});
