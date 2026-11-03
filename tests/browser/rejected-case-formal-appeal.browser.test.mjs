import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {readFileSync} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import {seedConsoleFile,seedConsoleEvidence} from "../helpers/interview-console-file-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {createRuntimePrivateObjectStorage}=loadWorkerRegistrationTs("src/lib/secure-files/private-object-storage.ts");

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes = []; for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter = Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=hash.at(-1)&15;
  return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const p=server.address().port;server.close(e=>e?reject(e):resolve(p));});});}
async function login(page,url,actor,role){
  await page.goto(url+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(actor.email);
  await page.getByLabel("Password",{exact:true}).fill(actor.password);
  if(actor.totpSecret) await page.getByLabel("Authenticator code").fill(totp(actor.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:25000});
}
async function fixtureCases(db,creds){
 const now=new Date().toISOString(),tenant=creds.company.tenantId,company=creds.company,worker=creds.worker;
 assert.ok(tenant && company.membershipId && worker.accountId);
 const link="company_worker_link_"+"z".repeat(24),invitation="worker_invitation_"+"z".repeat(24);
 await db.query("INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at) VALUES($1,$2,$3,$4,'accepted',$5,$6,clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())",[invitation,tenant,worker.email,"m21303-scoped-invitation",company.membershipId,worker.accountId]);
 await db.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,worker_accepted_at,activated_at) VALUES($1,$2,$3,'invitation',$4,'active',clock_timestamp(),clock_timestamp())",[link,tenant,worker.accountId,invitation]);
 const cases={};
 for(const [kind,suffix] of [["rejected","r"],["reassessment","s"]]){
   const orderId="assurance_order_"+suffix.repeat(24),targetId="assurance_target_"+suffix.repeat(24),caseId="assurance_case_"+suffix.repeat(24);
   await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'SUBMITTED',$6,$6,$6)",[orderId,tenant,company.membershipId,"M2.13.03 "+kind,"M21303-"+kind,now]);
   await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'company','submitted',$6,$6)",[targetId,orderId,tenant,link,worker.accountId,now]);
   await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Decision pending','admin','Record final decision.',$7,$7)",[caseId,orderId,targetId,tenant,link,worker.accountId,now]);
   cases[kind]={tenant,orderId,caseId};
 }
 return cases;
}
async function decision(page,url,c,state){
 await page.goto(url+"/admin/decisions?tenantId="+c.tenant+"&caseId="+c.caseId,{waitUntil:"domcontentloaded"});
 const form=page.locator("form").filter({has:page.getByRole("button",{name:"Create decision",exact:true})});
 await form.locator('[name="state"]').selectOption(state);
 await form.getByLabel("Reason code").fill("needs_followup");
 await form.getByLabel("Explanation").fill("Human follow-up is required before the case can close.");
 await form.getByLabel("Rule version").fill("m21303-browser");
 await form.getByLabel("Input references").fill("recorded-follow-up-request");
 await form.getByRole("button",{name:"Create decision",exact:true}).click();
}
test("M2.13.03 rejected unissued case appeal preserves source and requires independent MFA reviewer",{timeout:240000},async()=>{
 const root=await mkdtemp(join(tmpdir(),"hse-case-appeal-")),dir=join(root,"db"),credsFile=join(root,"creds.json"),port=await freePort(),url="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,HSE_AUDIT_CREDENTIALS_PATH:credsFile,HSE_RELEASE_SHA:"m21303-case-appeal",HSE_SESSION_SECRET:"m21303-case-appeal-session-secret-long-2026",HSE_AUTH_PEPPER:"m21303-case-appeal-pepper-secret-long-2026",HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 let file,followFile;
 try{
  for(const migration of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
   const result=spawnSync(process.execPath,[migration],{env:environment,encoding:"utf8"});
   assert.equal(result.status,0,result.stderr||result.stdout);
  }
  const creds=JSON.parse(await readFile(credsFile,"utf8"));
  const secondAccount="case_appeal_independent_admin_2026",secondEmail="case.appeal.independent@example.test";
  const second={...creds.admin,accountId:secondAccount,email:secondEmail};
  const foreignAccount="case_appeal_foreign_worker_2026",foreignEmail="case.appeal.other@example.test";
  const foreign={...creds.worker,accountId:foreignAccount,email:foreignEmail,totpSecret:null};
  const db=new PGlite(dir);let c,interviewCase,record,followRecord,foreignEvidence;
  try{
   const cases=await fixtureCases(db,creds);c=cases.rejected;interviewCase=cases.reassessment;
   const now=new Date().toISOString();
   await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
     SELECT $1,$2,'Independent case appeal reviewer','active',password_hash,$3,$3,$3,$3 FROM auth_accounts WHERE account_id=$4`,
     [secondAccount,secondEmail,now,creds.admin.accountId]);
   await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[secondAccount]);
   await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
     SELECT $1,$2,'Unrelated Worker','active',password_hash,$3,$3,$3,$3 FROM auth_accounts WHERE account_id=$4`,
     [foreignAccount,foreignEmail,now,creds.worker.accountId]);
   await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'worker')",[foreignAccount]);
   file=await seedConsoleFile(db,creds.worker.accountId,"case-appeal-retained-scanned-20261103");
   record=await seedConsoleEvidence(db,creds.worker.accountId,"qualification","case-appeal-owned-20261103",{file});
   const foreignFile=await seedConsoleFile(db,foreignAccount,"case-appeal-foreign-scanned-20261103");
   foreignEvidence=await seedConsoleEvidence(db,foreignAccount,"qualification","case-appeal-foreign-20261103",{file:foreignFile});
   await createRuntimePrivateObjectStorage("test").put(file.objectKey,file.bytes);
   followFile=await seedConsoleFile(db,creds.worker.accountId,"case-appeal-followup-scanned-20261103");
   followRecord=await seedConsoleEvidence(db,creds.worker.accountId,"qualification","case-appeal-followup-owned-20261103",{file:followFile});
   await createRuntimePrivateObjectStorage("test").put(followFile.objectKey,followFile.bytes);
   await db.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,created_at,activated_at)
    SELECT $1,$2,factor_type,encrypted_secret,'active',clock_timestamp(),clock_timestamp() FROM auth_mfa_factors WHERE account_id=$3 AND factor_status='active'`,
    ["independent_case_appeal_factor",secondAccount,creds.admin.accountId]);
  }finally{await db.close()}
  let appealId;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:url+"/admin/login",projectRoot:process.cwd(),environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const originalAdmin=await browser.newPage();await login(originalAdmin,url,creds.admin,"admin");
    await decision(originalAdmin,url,c,"REJECTED");
    await originalAdmin.getByRole("heading",{name:"REJECTED",exact:true}).waitFor({timeout:20000});
    const worker=await browser.newPage();await login(worker,url,creds.worker,"worker");
    const unrelated=await browser.newPage();await login(unrelated,url,foreign,"worker");
    await unrelated.goto(url+"/worker/case-appeals?caseId="+c.caseId,{waitUntil:"domcontentloaded"});
    assert.equal(await unrelated.getByRole("button",{name:"Submit case appeal"}).count(),0,"Foreign Worker must not receive a rejected case appeal form");
    assert.equal(await unrelated.getByText(c.caseId,{exact:true}).count(),0,"Foreign Worker must not see another Worker case reference");
    console.log("M21303_CROSS_WORKER_APPEAL_DENIED");
    await worker.goto(url+"/worker/assurance-cases/"+c.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByRole("link",{name:"Appeal this rejected case"}).click();
    await worker.waitForURL(url+"/worker/case-appeals?caseId="+c.caseId,{timeout:20000});
    await worker.getByLabel("Appeal grounds").fill("The rejected competence determination overlooked submitted evidence and must be independently reconsidered.");
    const ownBox=worker.locator('input[name="evidenceRecordIds"][value="'+record.recordId+'"]');
    await ownBox.waitFor({timeout:10000});
    await ownBox.check();
    await ownBox.evaluate((input,foreignId)=>{input.value=foreignId;},foreignEvidence.recordId);
    await worker.getByRole("button",{name:"Submit case appeal"}).click();
    await worker.waitForURL("**/worker/case-appeals?error=unavailable",{timeout:20000});
    console.log("M21303_FOREIGN_SCANNED_EVIDENCE_SUBMISSION_DENIED");
    await worker.goto(url+"/worker/case-appeals?caseId="+c.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByLabel("Appeal grounds").fill("The rejected competence determination overlooked submitted evidence and must be independently reconsidered.");
    await worker.locator('input[name="evidenceRecordIds"][value="'+record.recordId+'"]').check();
    await worker.getByRole("button",{name:"Submit case appeal"}).click();
    await worker.waitForURL("**/worker/case-appeals?status=submitted",{timeout:20000});
    await worker.getByText("Case appeal submitted for independent Admin review.",{exact:true}).waitFor();
    const article=worker.locator("article").filter({hasText:c.caseId});
    await article.getByText("Status: submitted",{exact:false}).waitFor();
    appealId=await article.getAttribute("id");
    assert.ok(/^case_appeal_/.test(appealId));
    console.log("M21303_FORMAL_APPEAL_WORKER_SUBMITTED",appealId);
    await worker.goto(url+"/worker/case-appeals?caseId="+c.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByLabel("Appeal grounds").fill("I request another independent look at the retained rejected case decision.");
    await worker.getByRole("button",{name:"Submit case appeal"}).click();
    await worker.waitForURL("**/worker/case-appeals?error=conflict",{timeout:20000});
    await worker.locator("p.status-banner[role=alert]").waitFor();
    await originalAdmin.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const originalForm=originalAdmin.getByRole("form",{name:"Review case appeal "+appealId});
    await originalForm.getByLabel("Review outcome").selectOption("accepted");
    await originalForm.getByLabel("Independent review reason").fill("The original decision maker is not allowed to review their own case appeal.");
    await originalForm.getByRole("button",{name:"Record case appeal review"}).click();
    await originalAdmin.waitForURL("**/admin/case-appeals?error=independence",{timeout:20000});
    await originalAdmin.getByText("Evidence restricted: original decision maker cannot inspect independent appeal files.",{exact:true}).waitFor();
    const blockedPreview=await originalAdmin.request.get(url+"/admin/case-appeals/"+appealId+"/files/"+file.fileId);
    assert.equal(blockedPreview.status(),404,"Original decision maker must not preview frozen case appeal evidence");
    console.log("M21303_ORIGINAL_DECISION_ADMIN_DENIED");
    const independent=await browser.newPage();await login(independent,url,second,"admin");
    await independent.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const fileLink=independent.getByRole("link",{name:"Open retained supporting file "+record.recordId});
    await fileLink.waitFor({timeout:20000});
    const preview=await independent.request.get(url+await fileLink.getAttribute("href"));
    assert.equal(preview.status(),200,"Independent Admin should preview the exact retained scanned PDF");
    assert.deepEqual(Buffer.from(await preview.body()),file.bytes);
    assert.match(preview.headers()["cache-control"],/private.*no-store/);
    console.log("M21303_INDEPENDENT_ADMIN_RETAINED_PDF_EXACT_BYTES");
    const staleRequest=await browser.newPage();
    await staleRequest.context().addCookies(await independent.context().cookies());
    await staleRequest.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const staleDecision=await browser.newPage();
    await staleDecision.context().addCookies(await independent.context().cookies());
    await staleDecision.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const requestForm=independent.getByRole("form",{name:"Request additional case evidence "+appealId});
    await requestForm.getByLabel("Additional evidence request reason").fill("Please submit the additional scanned qualification record for the independent case appeal.");
    await requestForm.getByRole("button",{name:"Request additional evidence"}).click();
    await independent.waitForURL("**/admin/case-appeals?status=evidence-requested",{timeout:20000});
    const duplicateRequest=staleRequest.getByRole("form",{name:"Request additional case evidence "+appealId});
    await duplicateRequest.getByLabel("Additional evidence request reason").fill("Repeated request from stale Admin page must not be persisted.");
    await duplicateRequest.getByRole("button",{name:"Request additional evidence"}).click();
    await staleRequest.waitForURL("**/admin/case-appeals?error=conflict",{timeout:20000});
    console.log("M21303_DUPLICATE_ADMIN_REQUEST_DENIED");
    console.log("M21303_ADMIN_REQUESTED_FOLLOWUP");
    await independent.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    await independent.getByText("Awaiting requested Worker evidence or Assessor interview recommendation before final appeal review.",{exact:true}).waitFor();
    assert.equal(await independent.getByRole("form",{name:"Review case appeal "+appealId}).count(),0);
    const pendingForm=staleDecision.getByRole("form",{name:"Review case appeal "+appealId});
    await pendingForm.locator('input[name="expectedVersion"]').evaluate(node=>{node.value="2";});
    await pendingForm.getByLabel("Review outcome").selectOption("accepted");
    await pendingForm.getByLabel("Independent review reason").fill("Attempt to close despite required outstanding evidence must fail.");
    await pendingForm.getByRole("button",{name:"Record case appeal review"}).click();
    await staleDecision.waitForURL("**/admin/case-appeals?error=conflict",{timeout:20000});
    console.log("M21303_PENDING_FOLLOWUP_FINAL_DENIED");
    await worker.goto(url+"/worker/case-appeals",{waitUntil:"domcontentloaded"});
    const pendingArticle=worker.locator("article[id='"+appealId+"']");
    const staleResponse=await browser.newPage();
    await staleResponse.context().addCookies(await worker.context().cookies());
    await staleResponse.goto(url+"/worker/case-appeals",{waitUntil:"domcontentloaded"});
    const respondForm=pendingArticle.getByRole("form",{name:/Respond to additional evidence/});
    await respondForm.getByLabel("Evidence response explanation").fill("Further qualifications have been scanned and should be considered in the independent appeal.");
    const foreignBox=respondForm.locator('input[name="evidenceRecordIds"][value="'+followRecord.recordId+'"]');
    await foreignBox.check();
    await foreignBox.evaluate((input,foreignId)=>{input.value=foreignId;},foreignEvidence.recordId);
    await respondForm.getByRole("button",{name:"Submit additional evidence response"}).click();
    await worker.waitForURL("**/worker/case-appeals?error=unavailable",{timeout:20000});
    console.log("M21303_FOREIGN_FOLLOWUP_EVIDENCE_DENIED");
    await worker.goto(url+"/worker/case-appeals",{waitUntil:"domcontentloaded"});
    const validResponse=worker.locator("article[id='"+appealId+"']").getByRole("form",{name:/Respond to additional evidence/});
    await validResponse.getByLabel("Evidence response explanation").fill("The new scanned qualification provides the missing verification evidence.");
    await validResponse.locator('input[name="evidenceRecordIds"][value="'+followRecord.recordId+'"]').check();
    await validResponse.getByRole("button",{name:"Submit additional evidence response"}).click();
    await worker.waitForURL("**/worker/case-appeals?status=evidence-submitted",{timeout:20000});
    const replayForm=staleResponse.locator("article[id='"+appealId+"']").getByRole("form",{name:/Respond to additional evidence/});
    await replayForm.getByLabel("Evidence response explanation").fill("Replaying an already submitted scanned evidence response must fail.");
    await replayForm.locator('input[name="evidenceRecordIds"][value="'+followRecord.recordId+'"]').check();
    await replayForm.getByRole("button",{name:"Submit additional evidence response"}).click();
    await staleResponse.waitForURL("**/worker/case-appeals?error=conflict",{timeout:20000});
    console.log("M21303_STALE_WORKER_RESPONSE_DENIED");
    console.log("M21303_WORKER_FOLLOWUP_SUBMITTED");
    await independent.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const additionalLink=independent.getByRole("link",{name:"Open retained supporting file "+followRecord.recordId});
    await additionalLink.waitFor({timeout:20000});
    const additionalPreview=await independent.request.get(url+await additionalLink.getAttribute("href"));
    assert.equal(additionalPreview.status(),200);
    assert.deepEqual(Buffer.from(await additionalPreview.body()),followFile.bytes);
    console.log("M21303_ADMIN_PREVIEWED_FOLLOWUP_EXACT_BYTES");
    const form=independent.getByRole("form",{name:"Review case appeal "+appealId});
    const stale=await browser.newPage();await stale.context().addCookies(await independent.context().cookies());
    await stale.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const staleForm=stale.getByRole("form",{name:"Review case appeal "+appealId});
    await form.getByLabel("Review outcome").selectOption("accepted");
    await form.getByLabel("Independent review reason").fill("Accepted after independent review. Reassessment will require a distinct policy-authorized application.");
    await form.getByRole("button",{name:"Record case appeal review"}).click();
    await independent.waitForURL("**/admin/case-appeals?status=updated",{timeout:20000});
    await staleForm.getByLabel("Review outcome").selectOption("rejected");
    await staleForm.getByLabel("Independent review reason").fill("Stale competing outcome should be rejected without modifying accepted appeal.");
    await staleForm.getByRole("button",{name:"Record case appeal review"}).click();
    await stale.waitForURL("**/admin/case-appeals?error=conflict",{timeout:20000});
    await worker.goto(url+"/worker/case-appeals",{waitUntil:"domcontentloaded"});
    const finished=worker.locator("article[id='"+appealId+"']");
    await finished.getByText("Status: accepted",{exact:false}).waitFor();
    console.log("M21303_INDEPENDENT_REVIEW_ACCEPTED_AND_STALE_DENIED");
    await decision(originalAdmin,url,interviewCase,"REJECTED");
    await originalAdmin.getByRole("heading",{name:"REJECTED",exact:true}).waitFor({timeout:20000});
    await worker.goto(url+"/worker/assurance-cases/"+interviewCase.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByRole("link",{name:"Appeal this rejected case"}).click();
    await worker.waitForURL("**/worker/case-appeals?caseId="+interviewCase.caseId,{timeout:20000});
    await worker.getByLabel("Appeal grounds").fill("An independent Assessor interview is needed to reconsider the second rejected case.");
    await worker.getByRole("button",{name:"Submit case appeal"}).click();
    await worker.waitForURL("**/worker/case-appeals?status=submitted",{timeout:20000});
    const secondArticle=worker.locator("article").filter({hasText:interviewCase.caseId});
    const interviewAppealId=await secondArticle.getAttribute("id");
    assert.match(interviewAppealId,/^case_appeal_/);
    await independent.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const requestInterview=independent.getByRole("form",{name:"Request independent appeal interview "+interviewAppealId});
    await requestInterview.getByLabel("Interview request reason").fill("The retained assessment record requires an additional calibrated Assessor interview.");
    await requestInterview.getByRole("button",{name:"Request independent interview"}).click();
    await independent.waitForURL("**/admin/case-appeals?status=interview-requested",{timeout:20000});
    await worker.goto(url+"/worker/case-appeals",{waitUntil:"domcontentloaded"});
    const listedInterview=worker.locator("article[id='"+interviewAppealId+"']");
    await listedInterview.getByText("Independent appeal interview requested",{exact:true}).waitFor();
    const waiting=listedInterview.getByText("Waiting for an eligible Assessor assignment.",{exact:true});
    const assigned=listedInterview.getByRole("link",{name:"Open independent appeal interview"});
    assert.equal(await waiting.count()+await assigned.count(),1,"Worker must get exactly one truthful interview destination or pending assignment");
    await independent.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    await independent.getByText("Awaiting requested Worker evidence or Assessor interview recommendation before final appeal review.",{exact:true}).waitFor();
    const blocked=await independent.getByRole("form",{name:"Review case appeal "+interviewAppealId}).count();
    assert.equal(blocked,0,"A pending Assessor interview must suppress final decision action");
    console.log("M21303_INTERVIEW_BROWSER: independent Admin requested; Worker status, Assessor matching and final-review wait verified");
   }finally{await browser.close()}
  }});
  const verify=new PGlite(dir);
  try{
   const appeals=(await verify.query("SELECT appeal_id,status,version,reviewer_account_id,case_id,decision_id FROM assurance_case_appeals WHERE case_id=$1",[c.caseId])).rows;
   assert.equal(appeals.length,1);assert.equal(appeals[0].status,"accepted");
   assert.equal(Number(appeals[0].version),4);assert.equal(appeals[0].reviewer_account_id,secondAccount);
   const frozen=(await verify.query("SELECT record_id,version_id,file_id,content_sha256,byte_size FROM assurance_case_appeal_evidence WHERE appeal_id=$1 ORDER BY created_at,file_id",[appeals[0].appeal_id])).rows;
   assert.equal(frozen.length,2);
   assert.equal(frozen[0].record_id,record.recordId);assert.equal(frozen[0].version_id,record.versionId);
   assert.equal(frozen[0].file_id,file.fileId);assert.equal(Number(frozen[0].byte_size),file.bytes.byteLength);
   await assert.rejects(verify.query("UPDATE assurance_case_appeal_evidence SET file_id='forged_file' WHERE appeal_id=$1",[appeals[0].appeal_id]),/immutable/i);
   const events=(await verify.query("SELECT version,status FROM assurance_case_appeal_events WHERE appeal_id=$1 ORDER BY version",[appeals[0].appeal_id])).rows;
   assert.deepEqual(events.map(e=>[Number(e.version),e.status]),[[1,"submitted"],[2,"under_review"],[3,"under_review"],[4,"accepted"]]);
   const request=(await verify.query("SELECT req.*,response.appeal_version AS response_version FROM assurance_case_appeal_evidence_requests req LEFT JOIN assurance_case_appeal_evidence_responses response ON response.request_id=req.request_id WHERE req.appeal_id=$1",[appeals[0].appeal_id])).rows;
   assert.equal(request.length,1);assert.equal(Number(request[0].response_version),3);
   assert.equal(frozen.some(row=>row.record_id===followRecord.recordId&&row.file_id===followFile.fileId),true);
   await assert.rejects(verify.query("UPDATE assurance_case_appeal_evidence_requests SET reason='tamper with immutable followup' WHERE request_id=$1",[request[0].request_id]),/immutable/i);
   await assert.rejects(verify.query("UPDATE assurance_case_appeal_evidence_responses SET reason='tamper with immutable followup response' WHERE request_id=$1",[request[0].request_id]),/immutable/i);
   await assert.rejects(verify.exec(readFileSync("database/migrations/0133_case_appeal_followup_evidence.down.sql","utf8")),/followup histories must be retained/i);
   const extra=(await verify.query("SELECT a.appeal_id,i.interview_request_id FROM assurance_case_appeals a JOIN assurance_case_appeal_interview_requests i ON i.appeal_id=a.appeal_id WHERE a.case_id=$1",[interviewCase.caseId])).rows;
   assert.equal(extra.length,1);
   const secondSource=(await verify.query("SELECT case_status,credential_reference FROM assurance_cases WHERE case_id=$1",[interviewCase.caseId])).rows[0];
   assert.equal(secondSource.case_status,"Rejected");assert.equal(secondSource.credential_reference,null);
   const source=(await verify.query("SELECT case_status,decision_reference,credential_reference FROM assurance_cases WHERE case_id=$1",[c.caseId])).rows[0];
   assert.equal(source.case_status,"Rejected");assert.equal(source.decision_reference,appeals[0].decision_id);assert.equal(source.credential_reference,null);
   assert.equal((await verify.query("SELECT COUNT(*)::integer AS n FROM platform_decisions WHERE case_id=$1",[c.caseId])).rows[0].n,1);
   await assert.rejects(verify.query("UPDATE assurance_case_appeal_events SET reason='tamper with immutable history' WHERE appeal_id=$1",[appeals[0].appeal_id]),/immutable/i);
   console.log("M21303_PERSISTENCE 1 appeal 4 immutable events original rejected decision unchanged");
  }finally{await verify.close()}
 }finally{
  if(file)await createRuntimePrivateObjectStorage("test").delete(file.objectKey);
  if(followFile)await createRuntimePrivateObjectStorage("test").delete(followFile.objectKey);
  await rm(root,{recursive:true,force:true});
 }
});