import assert from "node:assert/strict";
import test from "node:test";
import {createHmac} from "node:crypto";
import {createServer} from "node:net";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {integrityAssessmentFixture} from "../helpers/integrity-assessment-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";

function totp(secret){
  const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",bits=[...secret.toUpperCase().replace(/=+$/g,"")].map(c=>chars.indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const h=createHmac("sha1",Buffer.from(bytes)).update(b).digest(),offset=h.at(-1)&15;
  return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function port(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});}
async function login(page,base,actor,role){
  await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(actor.email);
  await page.getByLabel("Password",{exact:true}).fill(actor.password);
  if(actor.totpSecret)await page.getByLabel("Authenticator code").fill(totp(actor.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:25000});
}
async function createReviewDecision(page,base,source){
  await page.goto(base+"/admin/decisions?tenantId="+source.tenant_id+"&caseId="+source.case_id,{waitUntil:"domcontentloaded"});
  const form=page.locator("form").filter({has:page.getByRole("button",{name:"Create decision",exact:true})});
  await form.locator('[name="state"]').selectOption("PENDING_ADDITIONAL_REVIEW");
  await form.getByLabel("Reason code").fill("independent_written_check");
  await form.getByLabel("Explanation").fill("Independent verifier review of retained submitted written assessment is required.");
  await form.getByLabel("Rule version").fill("m21302-positive-e2e");
  await form.getByLabel("Input references").fill(source.assessment_reference);
  await form.getByRole("button",{name:"Create decision",exact:true}).click();
}
test("M2.13.02 submitted written assessment routes to Verifier; repeated Admin decision is atomic",{timeout:240000},async()=>{
  const f=await integrityAssessmentFixture({written:true});
  try{
    await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Isolate, lockout and verify zero energy before beginning work."},new Date(),null);
    const before=(await f.database.query("SELECT case_status,owner_kind,assessment_reference FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0];
    console.log("M21302_PRE_DECISION_CASE:",JSON.stringify(before));
    const reviews=(await f.database.query("SELECT review_id,reviewer_account_id,status FROM written_score_reviews WHERE case_id=$1",[f.sourceCase.case_id])).rows;
    console.log("M21302_PRE_DECISION_REVIEW:",JSON.stringify(reviews));
    assert.equal(before.assessment_reference,f.attemptId);
    assert.equal((await f.database.query("SELECT status FROM assessment_attempts WHERE attempt_id=$1",[f.attemptId])).rows[0].status,"SUBMITTED");
    await f.database.query("UPDATE assurance_cases SET case_status='Decision pending',owner_kind='admin',next_action='Record additional independent review decision.' WHERE case_id=$1",[f.sourceCase.case_id]);
    await f.releaseDatabase();
    const number=await port(),base="http://127.0.0.1:"+number;
    await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(number)],probeUrl:base+"/admin/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
      const browser=await chromium.launch({headless:true});
      try{
        const admin=await browser.newPage();await login(admin,base,f.credentials.admin,"admin");
        await createReviewDecision(admin,base,{...f.sourceCase,assessment_reference:f.attemptId});
        await admin.getByRole("heading",{name:"PENDING ADDITIONAL REVIEW",exact:true}).waitFor({timeout:25000});
        console.log("M21302_POSITIVE_ADMIN_DECISION_CREATED");
        const worker=await browser.newPage();await login(worker,base,f.credentials.worker,"worker");
        await worker.goto(base+"/worker/assurance-cases/"+f.sourceCase.case_id,{waitUntil:"domcontentloaded"});
        await worker.getByText("Status: Review pending",{exact:true}).waitFor({timeout:25000});
        const company=await browser.newPage();await login(company,base,f.credentials.company,"company");
        await company.goto(base+"/company/assurance-orders/"+f.sourceCase.order_id,{waitUntil:"domcontentloaded"});
        await company.getByText("Review pending",{exact:true}).first().waitFor({timeout:25000});
        const verifier=await browser.newPage();await login(verifier,base,f.credentials.verifier,"verifier");
        await verifier.goto(base+"/verifier/reviews/scoring",{waitUntil:"domcontentloaded"});
        console.log("M21302_VERIFIER_PAGE:",(await verifier.locator("main").innerText()).slice(0,550));
        await verifier.getByText(f.sourceCase.case_id,{exact:false}).waitFor({timeout:25000});
        await verifier.getByText("private-question-prompt-marker",{exact:true}).waitFor({timeout:25000});
        await createReviewDecision(admin,base,{...f.sourceCase,assessment_reference:f.attemptId});
        await admin.locator(".status-banner.status-error").getByText("Assurance Case is not ready for a final decision.",{exact:true}).waitFor({timeout:25000});
        console.log("M21302_REPEAT_DECISION_DENIED");
      }finally{await browser.close();}
    }});
    const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});
    try{
      const c=(await db.query("SELECT decision_reference,case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0];
      assert.equal(c.owner_kind,"reviewer");
      assert.match(c.next_action,/additional review/i);
      const tasks=(await db.query("SELECT owner_kind,deep_link,action_status FROM assurance_action_items WHERE case_id=$1 AND action_status='open'",[f.sourceCase.case_id])).rows;
      assert.deepEqual(tasks.map(x=>[x.owner_kind,x.deep_link]),[["reviewer","/verifier/reviews/scoring"]]);
      const review=(await db.query("SELECT review_id,reviewer_account_id,status FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows;
      assert.equal(review.length,1);
      assert.equal(review[0].reviewer_account_id,f.credentials.verifier.accountId);
      assert.equal(review[0].status,"DRAFT");
      console.log("M21302_POSITIVE_REVIEW: assigned Verifier, visible scoring form, correct review task");
      const decisions=(await db.query("SELECT decision_id FROM platform_decisions WHERE case_id=$1",[f.sourceCase.case_id])).rows;
      const timeline=(await db.query("SELECT event_type FROM assurance_case_timeline_events WHERE case_id=$1 AND event_type='decision_recorded'",[f.sourceCase.case_id])).rows;
      assert.equal(c.case_status,"Review pending");assert.equal(decisions.length,1);assert.equal(timeline.length,1);
      assert.equal(c.decision_reference,decisions[0].decision_id);
      console.log("M21302_REPLAY_DB: exactly one decision, one timeline, no duplicate progression");
    }finally{await db.close();}
  }finally{await f.cleanup();}
});
