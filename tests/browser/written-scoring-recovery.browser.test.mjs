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


import {integrityAssessmentFixture} from "../helpers/integrity-assessment-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
const {AssessmentIntegrityService}=loadWorkerRegistrationTs("src/lib/integrity/assessment-integrity-service.ts");


test("Verifier actual conflict control removes private review access and reaches Admin recovery",{timeout:180000},async()=>{
 const f=await integrityAssessmentFixture();
 try{
  await new AssessmentIntegrityService(Promise.resolve(f.database)).record(f.worker,f.attemptId,null,{type:"COPY_PASTE_DETECTED"});
  await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
  const review=(await f.database.query("SELECT review_id FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows[0];
  await f.releaseDatabase();
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/verifier/login",projectRoot:process.cwd(),environment:f.environment,probe:async({output})=>{
   const browser=await chromium.launch({headless:true});try{
    const page=await(await browser.newContext()).newPage();await login(page,baseUrl,f.credentials.verifier,"verifier");await page.goto(baseUrl+"/verifier/reviews/scoring");
    const form=page.getByRole("form",{name:"Declare scoring conflict"});
    await form.getByLabel("Scoring conflict reason").fill("I previously supervised this Worker and must not independently score this case.");
    await form.getByRole("button",{name:"Declare scoring conflict",exact:true}).click();
    await page.getByText("A declared conflict removes written scoring authority.",{exact:true}).waitFor();
    assert.equal(await page.getByText("private-question-prompt-marker",{exact:true}).count(),0);
    assert.equal(await page.getByRole("form",{name:"Declare scoring conflict"}).count(),0);
    const admin=await(await browser.newContext()).newPage();await login(admin,baseUrl,f.credentials.admin,"admin");await admin.goto(baseUrl+"/admin/operations/scoring-assignments");
    await admin.locator("article").filter({hasText:f.sourceCase.case_id}).getByText("No eligible Verifier. Resolve staffing or calibration first; the submitted answers remain retained.",{exact:false}).waitFor();
   }finally{await (await import("node:fs/promises")).writeFile(".autopilot/artifacts/20261015-scoring-recovery-server.log",output());await browser.close();}
  }});
  const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});try{
   assert.equal((await db.query("SELECT owner_kind FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0].owner_kind,"admin");
   assert.equal((await db.query("SELECT COUNT(*)::integer n FROM scoring_conflict_declarations WHERE review_id=$1",[review.review_id])).rows[0].n,1);
  }finally{await db.close();}
 }finally{await f.cleanup();}
});

test("Verifier actual amendment control retains final evidence and requires fresh rubric and explicit progression",{timeout:180000},async()=>{
 const f=await integrityAssessmentFixture({written:true});
 try{
  await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Prove isolation, test zero energy, then authorize safe work."},new Date(),null);
  const original=(await f.database.query("SELECT review_id FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows[0];
  await f.releaseDatabase();
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/verifier/login",projectRoot:process.cwd(),environment:f.environment,probe:async({output})=>{
   const browser=await chromium.launch({headless:true});try{
    const page=await(await browser.newContext()).newPage();await login(page,baseUrl,f.credentials.verifier,"verifier");await page.goto(baseUrl+"/verifier/reviews/scoring");
    async function markAndDecide(score,decision){
     const mark=page.getByRole("form",{name:"Rubric mark Q1:C0"});
     await mark.getByLabel("Criterion mark").fill(String(score));await mark.getByLabel("Mark reason").fill("Reasoned criterion mark against the retained isolation response.");
     await mark.getByRole("button",{name:"Save mark",exact:true}).click();
     await page.waitForFunction(()=>document.querySelector('input[name="expectedRevision"]')?.value==="1");
     const select=page.locator('select[name="decision"]');await select.selectOption(decision);
     const form=select.locator("xpath=ancestor::form");await form.locator('textarea[name="reason"]').fill("A current human scoring decision based on every saved rubric criterion.");
     await form.getByRole("button",{name:"Save scoring decision",exact:true}).click();
     const final=page.getByRole("button",{name:"Finalize review",exact:true});await final.waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==="Finalize review"&&!b.disabled));await final.click();
     await page.getByText("FINAL",{exact:true}).first().waitFor();
    }
    await markAndDecide(80,"PASS");
    const amendment=page.getByRole("form",{name:"Start scoring amendment"});await amendment.getByLabel("Scoring amendment reason").fill("A documented rubric interpretation error requires a corrected independent score.");
    await amendment.getByRole("button",{name:"Start scoring amendment",exact:true}).click();
    await page.getByText("Original finalized scoring evidence retained in amendment history.",{exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Finalize review",exact:true}).isEnabled(),false);
    await markAndDecide(50,"FAIL");
   }finally{await (await import("node:fs/promises")).writeFile(".autopilot/artifacts/20261015-scoring-recovery-server.log",output());await browser.close();}
  }});
  const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});try{
   const rows=(await db.query("SELECT status,score,decision FROM written_score_reviews WHERE attempt_id=$1 ORDER BY created_at,review_id",[f.attemptId])).rows;
   assert.ok(rows.some(r=>r.status==="SUPERSEDED"&&r.score===80&&r.decision==="PASS"));assert.ok(rows.some(r=>r.status==="FINAL"&&r.score===50&&r.decision==="FAIL"));
   assert.equal((await db.query("SELECT COUNT(*)::integer n FROM written_score_amendments WHERE original_review_id=$1",[original.review_id])).rows[0].n,1);
   assert.equal((await db.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0].case_status,"Reassessment required");
  }finally{await db.close();}
 }finally{await f.cleanup();}
});
