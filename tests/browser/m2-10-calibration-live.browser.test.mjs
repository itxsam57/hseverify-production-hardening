import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {integrityAssessmentFixture} from "../helpers/integrity-assessment-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret) {
 let bits="",bytes=[];
 for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(c).toString(2).padStart(5,"0");
 for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
 return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);
 server.listen(0,"127.0.0.1",()=>{const addr=server.address();server.close(error=>error?reject(error):resolve(addr.port));});});}
async function login(page,base,credentials,role) {
 await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
 await page.getByLabel("Email address").fill(credentials.email);
 await page.getByLabel("Password").fill(credentials.password);
 if(credentials.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credentials.totpSecret));
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});
}
function dateLocal(timestamp){return new Date(timestamp).toISOString().slice(0,19);}
test("M2.10.05 real Admin calibration FAILED and time-expired CURRENT block Verifier and show Worker holding state; live renewal restores review",{timeout:240000},async()=>{
 const f=await integrityAssessmentFixture({written:true});
 const clock=Date.now();
 try{
  await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Prove isolation and zero energy before authorizing work."},new Date(),null);
  const review=(await f.database.query("SELECT review_id FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows[0].review_id;
  const pinned=(await f.database.query(`SELECT frameworks.framework_reference, revisions.framework_version_id FROM assurance_cases cases
    JOIN assurance_case_policy_snapshots snapshots ON snapshots.case_id=cases.case_id
    JOIN assurance_frameworks frameworks ON frameworks.framework_id=snapshots.framework_id
    JOIN assurance_framework_revisions revisions ON revisions.framework_id=frameworks.framework_id
    WHERE cases.case_id=$1 ORDER BY revisions.version_no DESC LIMIT 1`,[f.sourceCase.case_id])).rows[0];
  assert.ok(pinned);
  await f.releaseDatabase();
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/verifier/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const admin=await(await browser.newContext()).newPage();
    const verifier=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const worker=await(await browser.newContext()).newPage();
    await login(admin,base,f.credentials.admin,"admin");
    await login(verifier,base,f.credentials.verifier,"verifier");
    await login(worker,base,f.credentials.worker,"worker");
    async function inspectReady(expected) {
      await verifier.goto(base+"/verifier/reviews/scoring");
      const form=verifier.getByRole("form",{name:"Rubric mark Q1:C0"});
      if(expected) {
       await form.waitFor({timeout:20000});
       assert.equal(await verifier.getByRole("button",{name:"Save scoring decision",exact:true}).isDisabled(),true);
      }else{
       await verifier.getByText(/Current written scoring calibration for the exact pinned framework revision is required/).waitFor({timeout:20000});
       assert.equal(await form.count(),0,"Blocked Verifier must not view the submitted written answer/rubric");
       assert.equal(await verifier.getByRole("button",{name:"Finalize review",exact:true}).count(),0);
      }
    }
    async function recordCalibration(status,fromMs,untilMs) {
      await admin.goto(base+"/admin/calibrations");
      const form=admin.locator("form").filter({has:admin.getByRole("button",{name:"Record calibration"})});
      await form.getByLabel("Staff member").selectOption(f.credentials.verifier.accountId);
      await form.locator('select[name="role"]').selectOption("verifier");
      await form.getByLabel("Framework reference").selectOption(pinned.framework_reference);
      await form.getByLabel("Framework revision").selectOption(pinned.framework_version_id);
      await form.locator('select[name="status"]').selectOption(status);
      await form.getByLabel("Valid from").fill(dateLocal(fromMs));
      await form.getByLabel("Valid until").fill(dateLocal(untilMs));
      await form.getByLabel("Calibration evidence / note").fill("Independent reviewed competence status; the previous live authority must be superseded.");
      await form.getByRole("button",{name:"Record calibration"}).click();
      await admin.getByRole("status").filter({hasText:"Calibration recorded."}).waitFor({timeout:20000});
    }
    await inspectReady(true);
    await recordCalibration("FAILED",clock-240000,clock+86400000);
    await inspectReady(false);
    await admin.goto(base+"/admin/operations/scoring-assignments");
    const article=admin.locator("article").filter({hasText:f.sourceCase.case_id});
    await article.getByText("No eligible Verifier. Resolve staffing or calibration first",{exact:false}).waitFor({timeout:20000});
    const options=await article.locator('select[name="reviewerAccountId"] option').allTextContents();
    assert.ok(!options.some(x=>x.includes("Independent Audit verifier")),"Admin cannot select failed reviewer.");
    await worker.goto(base+"/worker/assurance-cases/"+f.sourceCase.case_id);
    const pendingView=await worker.locator("body").innerText();
    assert.match(pendingView,/Review pending/,"Worker case status missing: "+pendingView.slice(0,700));
    await recordCalibration("CURRENT",clock-180000,clock+86400000);
    await inspectReady(true);
    await recordCalibration("CURRENT",clock-120000,clock-60000);
    await inspectReady(false);
    await recordCalibration("CURRENT",clock-30000,clock+86400000);
    await inspectReady(true);
    const form=verifier.getByRole("form",{name:"Rubric mark Q1:C0"});
    await form.getByLabel("Criterion mark").fill("83");
    await form.getByLabel("Mark reason").fill("Recalibrated Verifier reviewed the actual retained written response.");
    await form.getByRole("button",{name:"Save mark",exact:true}).click();
    await verifier.waitForFunction(()=>document.querySelector('input[name="expectedRevision"]')?.value==="1");
    const select=verifier.locator('select[name="decision"]');
    await select.selectOption("PASS");
    const decisionForm=select.locator("xpath=ancestor::form");
    await decisionForm.locator('textarea[name="reason"]').fill("Current restored calibration permits a human rubric-backed decision.");
    await decisionForm.getByRole("button",{name:"Save scoring decision",exact:true}).click();
    const finalize=verifier.getByRole("button",{name:"Finalize review",exact:true});
    await verifier.waitForFunction(()=>Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Finalize review"&&!b.disabled));
    await finalize.click();
    await verifier.getByText("FINAL",{exact:true}).waitFor({timeout:20000});
    await worker.reload();
    const progressedView=await worker.locator("body").innerText();
    assert.match(progressedView,/Interview pending/,"Worker progressed status missing: "+progressedView.slice(0,700));
   }finally{await browser.close();}
  }});
  const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});
  try{
   const scoring=(await db.query("SELECT status,decision,score FROM written_score_reviews WHERE review_id=$1",[review])).rows[0];
   assert.deepEqual(scoring,{status:"FINAL",decision:"PASS",score:83});
   const c=(await db.query("SELECT case_status,owner_kind FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0];
   assert.equal(c.case_status,"Interview pending");
   const history=(await db.query("SELECT status,valid_until FROM staff_calibrations WHERE account_id=$1 AND role='verifier' ORDER BY calibration_sequence DESC LIMIT 4",[f.credentials.verifier.accountId])).rows;
   assert.deepEqual(history.map(x=>x.status),["CURRENT","CURRENT","CURRENT","FAILED"]);
  }finally{await db.close();}
  console.log("ACTUAL_M21005_BROWSER Admin FAILED -> Verifier denied and Worker Review pending -> reinstated -> time-expired denied -> renewed -> Verifier final PASS and Worker Interview pending");
 }finally{await f.cleanup();}
});
