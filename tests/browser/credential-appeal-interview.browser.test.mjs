import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

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
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}

import {writeFile} from "node:fs/promises";
import {appealInterviewFixture} from "../helpers/appeal-interview-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
test("Actual Admin appeal interview -> Worker readiness -> Assessor console -> retained response -> independent final appeal",{timeout:300000},async()=>{
 const f=await appealInterviewFixture();let browser;
 try{
  const db=f.database,original=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0];
  await db.query("UPDATE auth_accounts SET password_hash=source.password_hash,password_set_at=source.password_set_at FROM auth_accounts source WHERE auth_accounts.account_id=$1 AND source.account_id=$2",[f.admin.accountId,f.credentials.admin.accountId]);
  await db.query("INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,created_at,activated_at) SELECT 'appeal-browser-independent-admin',$1,'totp',encrypted_secret,'active',clock_timestamp(),clock_timestamp() FROM auth_mfa_factors WHERE account_id=$2 AND factor_status='active'",[f.admin.accountId,f.credentials.admin.accountId]);
  const adminCredentials={...f.credentials.admin,accountId:f.admin.accountId,email:f.admin.email};
  await f.releaseDatabase();const environment={...f.environment,HSE_CREDENTIAL_SIGNING_SECRET:f.key};
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;browser=await chromium.launch({headless:true,args:["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"]});
  const admin=await(await browser.newContext()).newPage(),assessor=await(await browser.newContext({permissions:["camera","microphone"]})).newPage(),worker=await(await browser.newContext({permissions:["camera","microphone"]})).newPage();const errors=[];
  for(const page of [admin,assessor,worker]){page.on("pageerror",e=>errors.push(e.message));page.on("response",r=>{if(r.status()>=500)errors.push(r.status()+" "+new URL(r.url()).pathname);});}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",environment,projectRoot:process.cwd(),probe:async({output})=>{
   try{
    await login(admin,baseUrl,adminCredentials,"admin");await admin.goto(baseUrl+"/admin/appeals");const appeal=admin.locator('article[id="'+f.appeal.appealId+'"]');
    const followup=appeal.getByRole("form",{name:"Request followup "+f.appeal.appealId});await followup.getByLabel("Required followup").selectOption("interview");await followup.getByLabel("Reason for followup").fill("An independent structured interview is needed to assess these appeal grounds.");await followup.getByRole("button",{name:"Request appeal followup",exact:true}).click();await appeal.getByText("Response required",{exact:true}).waitFor();
    await login(worker,baseUrl,f.credentials.worker,"worker");await worker.goto(baseUrl+"/worker/appeals");const link=worker.locator('article[id="'+f.appeal.appealId+'"] ').getByRole("link",{name:"Open requested appeal interview",exact:true});const href=await link.getAttribute("href");assert.ok(href);const requestId=href.split("/").at(-1);
    await login(assessor,baseUrl,f.credentials.assessor,"assessor");await assessor.goto(baseUrl+"/assessor/interviews");const schedule=assessor.locator('input[name="interviewRequestId"][value="'+requestId+'"]').locator("xpath=ancestor::tr").first();await schedule.getByLabel("Interview time (UTC)").fill(new Date().toISOString().slice(0,16));await schedule.getByRole("button",{name:"Schedule",exact:true}).click();
    await assessor.goto(baseUrl+"/assessor/interviews/"+requestId);await assessor.getByRole("button",{name:"Claim interview",exact:true}).click();
    await worker.goto(baseUrl+href);await worker.getByRole("button",{name:"Enter waiting room",exact:true}).click();await worker.getByRole("button",{name:"Check camera, microphone & connection",exact:true}).click();await worker.getByText("Camera, microphone and connection checks passed.",{exact:true}).waitFor();await worker.getByLabel("I confirm I am the Worker assigned to this interview.").check();const consent=worker.getByLabel(/I consent to the interview recording required/);if(await consent.count())await consent.check();await worker.getByRole("button",{name:"Ready for Interview",exact:true}).click();await worker.getByText("Ready checks and required consent are recorded. Wait for the assigned Assessor to admit you.",{exact:true}).waitFor();
    await assessor.reload();await assessor.getByRole("button",{name:"Admit ready Worker",exact:true}).click();await Promise.all([assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"])).then(r=>r.finished()),assessor.getByRole("button",{name:"Start interview",exact:true}).click()]);await assessor.reload();await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    for(const label of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"])await assessor.getByLabel(label,{exact:true}).fill("3");await assessor.getByLabel("Scorecard comments",{exact:true}).fill("Independent appeal interview findings support the original retained decision.");await assessor.getByLabel("Recommendation",{exact:true}).selectOption("PASS");
    await Promise.all([assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"])).then(r=>r.finished()),assessor.getByRole("button",{name:"Save draft",exact:true}).click()]);await assessor.reload();await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();await writeFile(".autopilot/artifacts/20261015-appeal-console-save.txt",assessor.url()+"\n"+await assessor.locator("body").innerText());assert.equal(await assessor.getByLabel("Recommendation",{exact:true}).inputValue(),"PASS");await Promise.all([assessor.waitForResponse(r=>r.request().method()==="POST"&&Boolean(r.request().headers()["next-action"])).then(r=>r.finished()),assessor.getByRole("button",{name:"End interview",exact:true}).click()]);await assessor.reload();await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();await assessor.getByRole("button",{name:"Submit final recommendation",exact:true}).click();await assessor.getByText("Final interview record submitted and locked.",{exact:true}).waitFor();
    await admin.goto(baseUrl+"/admin/notifications");await admin.getByRole("button",{name:"Create persisted test notification",exact:true}).click();await admin.waitForURL("**/admin/notifications?notice=fixture-ready");const notice=admin.locator("li.notification-center-item").filter({has:admin.getByRole("heading",{name:"Appeal interview submitted",exact:true})});for(let attempt=0;attempt<20&&!(await notice.count());attempt++)await admin.reload();await notice.getByRole("button",{name:"Open",exact:true}).click();await admin.waitForURL("**/admin/appeals#"+f.appeal.appealId);await appeal.getByText("Response received",{exact:true}).waitFor();await appeal.getByText("Assessor recommendation: PASS",{exact:true}).waitFor();const review=appeal.getByRole("form",{name:"Review "+f.appeal.appealId,exact:true});await review.getByLabel("Review status").selectOption("rejected");await review.getByLabel("Reasoned review outcome").fill("The completed independent interview confirms the original reasoned credential outcome.");await review.getByRole("button",{name:"Record appeal review",exact:true}).click();await admin.waitForURL("**/admin/appeals?status=updated");
    await worker.goto(baseUrl+"/worker/appeals");await worker.locator('article[id="'+f.appeal.appealId+'"] ').getByText(/Status: rejected/).waitFor();
   }finally{await writeFile(".autopilot/artifacts/20261015-appeal-interview-browser-server.log",output());}
  }});
  const proof=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:environment.HSE_PGLITE_DATA_DIR});try{assert.deepEqual((await proof.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0],original);assert.equal((await proof.query("SELECT COUNT(*)::integer n FROM credential_appeal_followup_events WHERE appeal_id=$1 AND event_type='interview_submitted'",[f.appeal.appealId])).rows[0].n,1);}finally{await proof.close();}
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await f.cleanup();}
});
