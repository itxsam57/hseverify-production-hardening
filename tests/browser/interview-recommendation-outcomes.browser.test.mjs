import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { activeInterview } from "../helpers/interview-outcome-fixture.mjs";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) bits += B32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
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
        else if (!address || typeof address === "string") reject(new Error("No free port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, credential, role) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000, waitUntil: "domcontentloaded" }).catch(async error => {
    const route = new URL(page.url()).pathname;
    const feedback = await page.locator('[role="alert"], .feedback-banner').allTextContents();
    throw new Error(role + " login did not reach dashboard; route=" + route + "; feedback=" + JSON.stringify(feedback) + "; " + error.message);
  });
}


for(const [recommendation,status] of [
 ["CONDITIONAL_PASS","Decision pending"], ["ADDITIONAL_EVIDENCE_REQUIRED","Evidence pending"],
 ["REASSESSMENT_REQUIRED","Reassessment required"], ["SECOND_INTERVIEW_REQUIRED","Interview pending"],
 ["FAIL","Reassessment required"]
]) test(`Real Assessor form finalizes ${recommendation} and exposes case routing`,{timeout:300000},async()=>{
 const x=await activeInterview(),port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
 const roleStates={};
 const orderId=(await x.database.query("SELECT order_id FROM assurance_cases WHERE case_id=$1",[x.request.caseId])).rows[0].order_id;
 await x.database.close();
 try {
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/assessor/login",environment:x.fixture.environment,projectRoot:process.cwd(),probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try {
    const page=await browser.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
    await login(page,baseUrl,x.fixture.credentials.assessor,"assessor");
    await page.goto(baseUrl+"/assessor/interviews/"+x.request.interviewRequestId,{waitUntil:"domcontentloaded"});
    await page.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    for(const label of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"])
      await page.getByLabel(label,{exact:true}).fill("3");
    await page.getByLabel("Scorecard comments",{exact:true}).fill("Candidate evidence supports this reasoned recommendation: "+recommendation);
    await page.getByLabel("Recommendation",{exact:true}).selectOption(recommendation);
    await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/assessor/interviews/")),page.getByRole("button",{name:"Save draft",exact:true}).click()]);
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    assert.equal(await page.getByLabel("Recommendation",{exact:true}).inputValue(),recommendation);
    await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/assessor/interviews/")),page.getByRole("button",{name:"End interview",exact:true}).click()]);
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    await page.getByRole("button",{name:"Submit final recommendation",exact:true}).click();
    await page.getByText("Final interview record submitted and locked.",{exact:true}).waitFor();
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    assert.equal(await page.getByLabel("Recommendation",{exact:true}).inputValue(),recommendation);
    assert.equal(await page.getByLabel("Recommendation",{exact:true}).isDisabled(),true);
    assert.equal(errors.length,0,errors.join("\n"));
    const worker=await browser.newPage();await login(worker,baseUrl,x.fixture.credentials.worker,"worker");
    await worker.goto(baseUrl+"/worker/assurance-cases/"+x.request.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByText("Status: "+status,{exact:true}).waitFor();
    const company=await browser.newPage();await login(company,baseUrl,x.fixture.credentials.company,"company");
    await company.goto(baseUrl+"/company/assurance-orders/"+orderId,{waitUntil:"domcontentloaded"});
    await company.getByText(status,{exact:true}).first().waitFor();
    roleStates.worker=await worker.context().storageState();
    roleStates.company=await company.context().storageState();
   } finally {await browser.close();}
  }});
  assert.equal(result.requestedSignal,"SMOKE_COMPLETE",result.output);
  assert.equal(result.responseStatus,200);
  const built=spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{cwd:process.cwd(),env:x.fixture.environment,encoding:"utf8"});
  assert.equal(built.status,0,built.stderr||built.stdout);
  for(let attempt=0;attempt<60;attempt++){
   const probe=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);let jobs;
   try{jobs=(await probe.query("SELECT status FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='interview.recommended'")).rows;assert.equal(jobs.length,1);assert.notEqual(jobs[0].status,"terminal_failed");}finally{await probe.close();}
   if(jobs[0].status==="succeeded")break;
   assert.ok(attempt<59,"Bounded actual worker must project recommendation source");
   const worker=spawnSync(process.execPath,["scripts/run-outbox-worker.mjs","--once"],{cwd:process.cwd(),env:x.fixture.environment,encoding:"utf8"});
   const outcome=JSON.parse(worker.stdout.trim());assert.equal(outcome.processed,1,worker.stderr||worker.stdout);
  }
  const checked=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);try{const rows=(await checked.query("SELECT notification_type,recipient_role,title FROM platform_notifications WHERE notification_type='interview.recommended'")).rows; console.log("Projected recommendation recipients: "+JSON.stringify(rows));assert.ok(rows.some(row=>row.recipient_role==="worker"),"Actual CLI must persist Worker projection");}finally{await checked.close();}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",environment:x.fixture.environment,projectRoot:process.cwd(),probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    for(const role of ["worker","company",...(["CONDITIONAL_PASS","SECOND_INTERVIEW_REQUIRED"].includes(recommendation)?["admin"]:[])]){
     // Preserve actual authenticated sessions across the server restart. Logging
     // Company in again in the same TOTP window correctly triggers replay denial.
     const page=await(await browser.newContext(roleStates[role]?{storageState:roleStates[role]}:{})).newPage();
     if(!roleStates[role])await login(page,baseUrl,x.fixture.credentials[role],role);
     await page.goto(baseUrl+"/"+role+"/notifications");
     const item=page.locator(".notification-center-item").filter({hasText:"Interview recommendation submitted"});await item.waitFor().catch(error=>{throw new Error(role+" notification missing; headings="+JSON.stringify(error.message));});
     assert.ok(!(await item.innerText()).includes("Candidate evidence"),"Private scorecard comments must not enter notification copy");
     await item.getByRole("button",{name:"Open",exact:true}).click();
     if(role==="worker"){await page.waitForURL("**/worker/assurance-cases/"+x.request.caseId);await page.getByText("Status: "+status,{exact:true}).waitFor();}
     if(role==="company"){await page.waitForURL("**/company/assurance-orders/"+orderId+"#"+x.request.caseId);}
     if(role==="admin"){await page.waitForURL("**/admin/decisions?tenantId=*&caseId="+x.request.caseId);assert.equal(await page.getByLabel("Case ID",{exact:true}).first().inputValue(),x.request.caseId);}
    }
   }finally{await browser.close();}
  }});

  const db=await PGlite.create(x.fixture.environment.HSE_PGLITE_DATA_DIR);
  try {
   const draft=(await db.query("SELECT recommendation,submitted FROM interview_console_drafts WHERE interview_request_id=$1",[x.request.interviewRequestId])).rows[0];
   assert.equal(draft.recommendation,recommendation);assert.equal(draft.submitted,true);
   assert.equal((await db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[x.request.caseId])).rows[0].case_status,status);
  } finally {await db.close();}
 } finally {await x.fixture.cleanup();}
});
