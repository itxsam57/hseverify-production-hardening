import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {integrityAssessmentFixture} from "../helpers/integrity-assessment-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";

const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){
 let bits="",bytes=[];
 for(const char of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(char).toString(2).padStart(5,"0");
 for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
 return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1_000_000).padStart(6,"0");
}
function freePort(){
 return new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
   const addr=server.address();server.close(error=>error?reject(error):resolve(addr.port));
  });
 });
}
async function login(page,baseUrl,credential,role){
 await page.goto(baseUrl+"/"+role+"/login",{waitUntil:"domcontentloaded"});
 await page.getByLabel("Email address").fill(credential.email);
 await page.getByLabel("Password").fill(credential.password);
 if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});
}
async function markAndFinalize(page,markValue,decision){
 await page.goto(page.url().split("/verifier/")[0]+"/verifier/reviews/scoring");
 const form=page.getByRole("form",{name:"Rubric mark Q1:C0"});
 await form.getByLabel("Criterion mark").fill(String(markValue));
 await form.getByLabel("Mark reason").fill("Actual independent safety isolation criterion marked against retained written answer.");
 await form.getByRole("button",{name:"Save mark",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('input[name="expectedRevision"]')?.value==="1");
 const select=page.locator('select[name="decision"]');
 await select.selectOption(decision);
 const decisionForm=select.locator("xpath=ancestor::form");
 await decisionForm.locator('textarea[name="reason"]').fill("Reasoned independent reviewer assessment with retained original and pinned rubric evidence.");
 await decisionForm.getByRole("button",{name:"Save scoring decision",exact:true}).click();
 const submit=page.getByRole("button",{name:"Finalize review",exact:true});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Finalize review"&&!b.disabled));
 await submit.click();
 await page.getByText("FINAL",{exact:true}).first().waitFor({timeout:20000});
}

test("real Verifier -> Admin MFA -> different Verifier additional-review flow retains both scoring decisions",{timeout:240000},async()=>{
 const f=await integrityAssessmentFixture({written:true});
 const secondId="audit_second_verifier_"+randomUUID().replaceAll("-","").slice(0,16);
 const secondEmail="second.verifier."+randomUUID()+"@example.test";
 const secondCredentials={...f.credentials.verifier,email:secondEmail,accountId:secondId};
 try{
  await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Prove isolation and zero energy before authorizing the work."},new Date(),null);
  const first=(await f.database.query("SELECT review_id FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows[0].review_id;
  await f.database.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at,password_hash,password_set_at)
   SELECT $1,$2,'Independent Second Verifier','active',CURRENT_TIMESTAMP,password_hash,password_set_at
   FROM auth_accounts WHERE account_id=$3`,[secondId,secondEmail,f.credentials.verifier.accountId]);
  await f.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[secondId]);
  await f.database.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
   SELECT $1,$2,factor_type,encrypted_secret,'active',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
   FROM auth_mfa_factors WHERE account_id=$3 AND factor_status='active'`,["synthetic_second_mfa_"+randomUUID(),secondId,f.credentials.verifier.accountId]);
  await f.database.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id)
   SELECT $1,$2,'verifier',framework_reference,status,valid_from,valid_until,'Independent second Verifier calibrated',recorded_by_account_id,framework_id,framework_version_id
   FROM staff_calibrations WHERE account_id=$3 ORDER BY calibration_sequence DESC LIMIT 1`,["staff_calibration_"+randomUUID().replaceAll("-","").slice(0,24),secondId,f.credentials.verifier.accountId]);
  await f.releaseDatabase();
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/verifier/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const firstPage=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const adminPage=await(await browser.newContext()).newPage();
    const secondPage=await(await browser.newContext()).newPage();
    await login(firstPage,baseUrl,f.credentials.verifier,"verifier");
    await markAndFinalize(firstPage,68,"ADDITIONAL_REVIEW");
    assert.equal(await firstPage.getByRole("form",{name:"Start scoring amendment"}).count(),0,"Initial reviewer cannot self-amend an additional-review hold.");
    await login(adminPage,baseUrl,f.credentials.admin,"admin");
    await adminPage.goto(baseUrl+"/admin/operations/scoring-assignments");
    const article=adminPage.locator("article").filter({hasText:f.sourceCase.case_id});
    const select=article.getByLabel("Calibrated independent Verifier");
    await select.waitFor({timeout:20000});
    const choices=await select.locator("option").allTextContents();
    assert.ok(choices.includes("Independent Second Verifier"));
    assert.ok(!choices.some(t=>t.includes("Independent Audit verifier")),"Original Verifier must not be eligible");
    await select.selectOption(secondId);
    await article.getByLabel("Assignment reason").fill("Independent second scoring review is required before case progression.");
    await article.getByRole("button",{name:"Assign assessment review"}).click();
    await article.getByRole("status").filter({hasText:"Assessment review assigned"}).waitFor({timeout:20000});
    await login(secondPage,baseUrl,secondCredentials,"verifier");
    await markAndFinalize(secondPage,91,"PASS");
   }finally{await browser.close();}
  }});
  const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});
  try{
   const rows=(await db.query("SELECT review_id,reviewer_account_id,score,decision,status FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows;
   assert.equal(rows.length,2);assert.ok(rows.some(r=>r.review_id===first&&r.decision==="ADDITIONAL_REVIEW"&&r.status==="SUPERSEDED"));
   assert.ok(rows.some(r=>r.reviewer_account_id===secondId&&r.decision==="PASS"&&r.status==="FINAL"&&r.score===91));
   const caseRow=(await db.query("SELECT owner_kind,case_status FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0];
   assert.equal(caseRow.case_status,"Interview pending");
   assert.ok(["assessor","admin"].includes(caseRow.owner_kind));
   assert.equal((await db.query("SELECT count(*)::integer AS n FROM written_score_amendments WHERE original_review_id=$1",[first])).rows[0].n,1);
   const audit=(await db.query("SELECT count(*)::integer AS n FROM platform_audit_events WHERE metadata->>'previousDecision'='ADDITIONAL_REVIEW'")).rows[0].n;
   assert.equal(audit,1);
  }finally{await db.close();}
  console.log("ACTUAL_M21003_BROWSER 390px first Verifier ADDITIONAL_REVIEW -> Admin MFA reassignment -> independent Verifier PASS -> case Interview pending");
 }finally{await f.cleanup();}
});
