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



import {assessorInterviewSearchFixture} from "../../tests/helpers/assessor-interview-search-fixture.mjs";





import {loadWorkerRegistrationTs} from "../../tests/helpers/worker-registration-runtime-loader.mjs";
const {InterviewAssignmentService}=loadWorkerRegistrationTs("src/lib/interview/interview-assignment-service.ts");
const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const {formatDateTime}=loadWorkerRegistrationTs("src/lib/format.ts");
async function recoveryContext(fixture,eligible){
 const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const admin={accountId:fixture.credentials.admin.accountId,activeRole:"admin",accountStatus:"active",tenantMembership:null},matching=new InterviewAssignmentService(db);
  for(const p of await matching.listProfiles(admin))await matching.upsertProfile(admin,{...p,status:"PAUSED"});
  if(eligible){
   await matching.upsertProfile(admin,{assessorAccountId:fixture.credentials.assessor.accountId,tradeScopes:["*"],qualificationScopes:["*"],languages:["*"],jurisdictions:["*"],riskLevels:["*"],availability:{},maxActiveInterviews:8,status:"ACTIVE"});
   await new StaffCalibrationService(Promise.resolve(db)).record(admin,{accountId:fixture.credentials.assessor.accountId,role:"assessor",frameworkReference:"SEARCH-WORKER",status:"CURRENT",validFrom:new Date(Date.now()-86400000),validUntil:new Date(Date.now()+86400000),note:"Current calibration created by the actual producer for browser recovery."});
  }
  // Schema-valid owned case context; this fixture does not certify order funding/progression.
  const original=fixture.requests.Alpha;
  await db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[original.caseId,original.interviewRequestId]);
  return (await db.query("SELECT order_id FROM assurance_cases WHERE case_id=$1",[original.caseId])).rows[0].order_id;
 }finally{await db.close();}
}
for(const scenario of [{outcome:"NO_SHOW",eligible:true},{outcome:"TECHNICAL_HOLD",eligible:true},{outcome:"NO_SHOW",eligible:false}]){
 test("Actual "+scenario.outcome+" replacement reaches "+(scenario.eligible?"Worker and Company appointments":"the Admin matching queue"),{timeout:180000},async()=>{
  const fixture=await assessorInterviewSearchFixture(),orderId=await recoveryContext(fixture,scenario.eligible),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
  let replacementId,scheduledAt;
  const original=fixture.requests.Alpha,reason="Private assessor diagnostics require a replacement appointment.";
  try{
   await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
    await login(page,baseUrl,fixture.credentials.assessor,"assessor");
    await page.goto(baseUrl+"/assessor/interviews",{waitUntil:"domcontentloaded"});
    const oldRow=page.getByRole("row").filter({has:page.getByText(original.caseId,{exact:true})});
    await oldRow.getByLabel("Interview time (UTC)").fill(new Date(Date.now()-45*60000).toISOString().slice(0,16));
    await oldRow.getByRole("button",{name:"Schedule",exact:true}).click();
    await oldRow.getByRole("button",{name:"Reschedule interview",exact:true}).waitFor();
    await oldRow.getByRole("link",{name:"Open interview console",exact:true}).click();
    if(scenario.outcome==="NO_SHOW")await page.getByRole("button",{name:"Mark Worker no-show",exact:true}).click();
    else{
     await page.getByLabel("Technical issue",{exact:true}).fill("Connection could not be restored.");
     await page.getByRole("button",{name:"Put on technical hold",exact:true}).click();
    }
    await page.getByText(scenario.outcome,{exact:true}).waitFor();
    await page.getByLabel("Notes",{exact:true}).fill("Original interview observations retained.");
    const draftSaved=page.waitForResponse(response=>response.request().method()==="POST" && Boolean(response.request().headers()["next-action"]));
    await page.getByRole("button",{name:"Save draft",exact:true}).click();
    assert.equal((await draftSaved).status(),200);
    await page.reload({waitUntil:"domcontentloaded"});
    assert.equal(await page.getByLabel("Notes",{exact:true}).inputValue(),"Original interview observations retained.");
    const replacementReason=page.getByLabel("Replacement reason",{exact:true});
    await replacementReason.fill("tiny");
    await replacementReason.evaluate(element=>{element.minLength=0;});
    await page.getByRole("button",{name:"Request replacement interview",exact:true}).click();
    await page.waitForURL("**/assessor/interviews/"+original.interviewRequestId+"?recoveryError=invalid");
     await page.getByRole("alert").filter({hasText:"Provide a reason between 10 and 1000 characters."}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("recoveryError"),"invalid");
    assert.equal(new URL(page.url()).searchParams.has("replacementReason"),false);
    const staleFinalPage=await page.context().newPage();
    await staleFinalPage.goto(baseUrl+"/assessor/interviews/"+original.interviewRequestId,{waitUntil:"domcontentloaded"});
    for(const field of await staleFinalPage.locator('input[type="number"]').all())await field.fill("3");
    await staleFinalPage.getByLabel("Recommendation",{exact:true}).selectOption("PASS");
    const staleComments="A complete stale recommendation must be rejected after replacement.";
    await staleFinalPage.getByRole("textbox",{name:"Scorecard comments",exact:true}).fill(staleComments);
    const stalePage=await page.context().newPage();
     await stalePage.goto(baseUrl+"/assessor/interviews/"+original.interviewRequestId,{waitUntil:"domcontentloaded"});
    const oldSessionId=await stalePage.locator('input[name="interviewSessionId"]').inputValue();
     await page.getByLabel("Replacement reason",{exact:true}).fill(reason);
    await page.getByRole("button",{name:"Request replacement interview",exact:true}).click();
    await page.waitForURL("**/assessor/interviews?recoverySaved=yes");
    await page.getByRole("status").filter({hasText:"Replacement interview requested."}).waitFor();
    assert.equal(new URL(page.url()).searchParams.has("replacementReason"),false);
    await stalePage.getByRole("button",{name:"Save draft",exact:true}).click();
    await stalePage.waitForURL("**/assessor/interviews/"+original.interviewRequestId+"?consoleError=closed");
    await stalePage.getByRole("alert").filter({hasText:"This interview is closed."}).waitFor();
    await stalePage.close();
    // Adversarial stale submission: bypass only the disabled client control.
    const finalButton=staleFinalPage.getByRole("button",{name:"Submit final recommendation",exact:true});
    assert.equal(await finalButton.evaluate(button=>button.form.checkValidity()),true);
    const finalRequest=staleFinalPage.waitForRequest(request=>request.method()==="POST" && Boolean(request.headers()["next-action"]));
    const finalResponse=staleFinalPage.waitForResponse(response=>response.request().method()==="POST" && Boolean(response.request().headers()["next-action"]));
    await staleFinalPage.getByRole("button",{name:"Submit final recommendation",exact:true}).evaluate(button=>{button.disabled=false;});
    await staleFinalPage.getByRole("button",{name:"Submit final recommendation",exact:true}).click();
    const posted=(await finalRequest).postData();
    for(const value of [original.interviewRequestId,oldSessionId,staleComments,"PASS"])assert(posted.includes(value),"The actual stale final POST must retain "+value);
    assert((await finalResponse).status()<500);
    await staleFinalPage.waitForURL("**/assessor/interviews/"+original.interviewRequestId+"?consoleError=closed");
    await staleFinalPage.getByRole("alert").filter({hasText:"This interview is closed."}).waitFor();
    await staleFinalPage.close();
    if(scenario.eligible){
     const row=page.getByRole("row").filter({has:page.getByText(original.caseId,{exact:true})}).filter({has:page.getByRole("button",{name:"Schedule",exact:true})});
     replacementId=await row.locator('input[name="interviewRequestId"]').first().inputValue();
     assert.notEqual(replacementId,original.interviewRequestId);
     const forgedPage=await page.context().newPage();
     await forgedPage.goto(baseUrl+"/assessor/interviews/"+replacementId,{waitUntil:"domcontentloaded"});
     await forgedPage.getByLabel("Notes",{exact:true}).fill("A forged old session must not alter archived notes.");
     await forgedPage.locator('input[name="interviewSessionId"]').evaluate((input,value)=>{input.value=value;},oldSessionId);
     const forgedRequest=forgedPage.waitForRequest(request=>request.method()==="POST" && Boolean(request.headers()["next-action"]));
     await forgedPage.getByRole("button",{name:"Save draft",exact:true}).click();
     assert((await forgedRequest).postData().includes(oldSessionId),"The actual forged POST must contain the archived session ID.");
     await forgedPage.waitForURL("**/assessor/interviews/"+replacementId+"?consoleError=closed");
     await forgedPage.getByRole("alert").filter({hasText:"This interview is closed."}).waitFor();
     await forgedPage.close();
     const time=new Date(Date.now()+86400000).toISOString().slice(0,16);scheduledAt=new Date(time+"Z").toISOString();
     await row.getByLabel("Interview time (UTC)").fill(time);
     await row.getByRole("button",{name:"Schedule",exact:true}).click();
     await page.getByRole("row").filter({has:page.locator('input[name="interviewRequestId"][value="'+replacementId+'"]')}).getByRole("button",{name:"Reschedule interview",exact:true}).waitFor();
     const companyContext=await browser.newContext({viewport:{width:390,height:844}}),companyPage=await companyContext.newPage();
     await login(companyPage,baseUrl,fixture.credentials.company,"company");
     await companyPage.goto(baseUrl+"/company/assurance-orders/"+orderId+"#"+original.caseId,{waitUntil:"domcontentloaded"});
     const caseRow=companyPage.locator("tr[id="+original.caseId+"]");
     assert((await caseRow.innerText()).includes(formatDateTime(scheduledAt)));
     assert(!(await caseRow.innerText()).includes(reason));
     assert.equal(await companyPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     await companyPage.reload({waitUntil:"domcontentloaded"});assert((await caseRow.innerText()).includes(formatDateTime(scheduledAt)));
     await companyContext.close();
    }else{
     const adminContext=await browser.newContext({viewport:{width:390,height:844}}),adminPage=await adminContext.newPage();
     await login(adminPage,baseUrl,fixture.credentials.admin,"admin");
     await adminPage.goto(baseUrl+"/admin/assessor-matching",{waitUntil:"domcontentloaded"});
     const row=adminPage.locator("article.record-row").filter({has:adminPage.getByRole("button",{name:"Run automatic match",exact:true})});
     assert.equal(await row.count(),1);
     replacementId=await row.locator('input[name="interviewRequestId"]').first().inputValue();
     assert.notEqual(replacementId,original.interviewRequestId);
     assert.equal(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     await adminContext.close();
    }
    await page.goto(baseUrl+"/assessor/interviews/"+original.interviewRequestId,{waitUntil:"domcontentloaded"});
    await page.getByRole("status").filter({hasText:"This interview is archived."}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Request replacement interview",exact:true}).count(),0);
    assert.equal(await page.getByRole("button",{name:"Resume interview",exact:true}).count(),0);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const workerContext=await browser.newContext({viewport:{width:390,height:844}}),workerPage=await workerContext.newPage();
    await login(workerPage,baseUrl,fixture.credentials.worker,"worker");
    await workerPage.goto(baseUrl+"/worker/interviews/"+original.interviewRequestId,{waitUntil:"domcontentloaded"});
    assert.equal(await workerPage.getByRole("button",{name:"Record technical issue",exact:true}).count(),0);
    await workerPage.getByRole("link",{name:"Open replacement interview",exact:true}).click();
    await workerPage.waitForURL("**/worker/interviews/"+replacementId);
    if(scheduledAt)assert((await workerPage.locator("body").innerText()).includes(formatDateTime(scheduledAt)));
    assert.equal(await workerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await workerContext.close();
   }});
   const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
   try{
    const current=(await db.query("SELECT interview_reference,owner_kind FROM assurance_cases WHERE case_id=$1",[original.caseId])).rows[0];
    assert.equal(current.interview_reference,replacementId);assert.equal(current.owner_kind,scenario.eligible?"assessor":"admin");
    const old=(await db.query("SELECT status FROM interview_requests WHERE interview_request_id=$1",[original.interviewRequestId])).rows[0];assert.equal(old.status,"CANCELLED");
    const draft=(await db.query("SELECT notes,scorecard,recommendation,submitted FROM interview_console_drafts WHERE interview_request_id=$1",[original.interviewRequestId])).rows;
    assert.equal(draft.length,1);assert.equal(draft[0].notes[0].content,"Original interview observations retained.");
    assert.equal(draft[0].recommendation,null);assert.equal(draft[0].submitted,false);
    assert.equal(draft[0].scorecard.technicalKnowledge,null);
    assert.equal(draft[0].scorecard.comments,null);
    assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM interview_console_drafts WHERE interview_request_id=$1",[replacementId])).rows[0].n),0);
    assert.equal((await db.query("SELECT status FROM interview_runtime_sessions WHERE interview_request_id=$1",[original.interviewRequestId])).rows[0].status,scenario.outcome);
    const next=(await db.query("SELECT status,scheduled_at,replaces_interview_request_id FROM interview_requests WHERE interview_request_id=$1",[replacementId])).rows[0];
    assert.equal(next.replaces_interview_request_id,original.interviewRequestId);assert.equal(next.status,scenario.eligible?"ASSIGNED":"REQUESTED");
    assert.equal(next.scheduled_at?new Date(next.scheduled_at).toISOString():null,scheduledAt??null);
    assert.equal(Number((await db.query("SELECT COUNT(*) AS count FROM platform_audit_events WHERE action_key='interview.replacement.requested' AND target_reference=$1",[original.interviewRequestId])).rows[0].count),1);
   }finally{await db.close();}
  }finally{await browser.close();await fixture.cleanup();}
 });
}
