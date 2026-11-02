import assert from "node:assert/strict";
import test from "node:test";
import {createHash,createHmac} from "node:crypto";
import {createServer} from "node:net";
import {PGlite} from "@electric-sql/pglite";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {assessmentFundingFixture,fundingPrincipal} from "../helpers/assessment-funding-fixture.mjs";
import {completeFundedCaseObjectiveAssessment} from "../helpers/completed-funded-assessment-fixture.mjs";
import {seedPublishedQuestion} from "../helpers/question-publication-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const {CaseAppealService}=loadWorkerRegistrationTs("src/lib/assurance/case-appeal-service.ts");
const {DecisionRepository}=loadWorkerRegistrationTs("src/lib/decision/decision-engine-repository.ts");
const {createDecision}=loadWorkerRegistrationTs("src/lib/decision/decision-engine-domain.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const hash=t=>createHash("sha256").update(t).digest("hex");
function totp(secret){
 const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",bits=[...secret.toUpperCase().replace(/=+$/g,"")].map(c=>chars.indexOf(c).toString(2).padStart(5,"0")).join("");
 const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(b).digest(),offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function port(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});}
test("Worker accepted unissued-case appeal opens exact authorized new case and retains lineage after funding",{timeout:220000},async()=>{
 const f=await assessmentFundingFixture();const db=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
 let originalId,decisionId,appealId;
 try{
  const now=new Date(),applications=new WorkerAssessmentApplicationService(db);
  const request=await applications.requestCompanyFunding(f.worker,f.fundingInput,now);
  await applications.decideCompanyFunding(f.company,{fundingRequestId:request.fundingRequestId,approved:true,now});
  const original=(await db.query("SELECT cases.* FROM assurance_cases cases JOIN worker_assessment_applications applications ON applications.assurance_case_id=cases.case_id WHERE applications.application_id=$1",[request.applicationId])).rows[0];
  originalId=original.case_id;
  await completeFundedCaseObjectiveAssessment(db,originalId,now);
  const decision=createDecision({tenantId:original.tenant_id,caseId:originalId,state:"REJECTED",
   reasonCode:"competency_gap",explanation:"Original independent assessment does not meet the pinned competency threshold.",ruleVersion:"case-appeal-browser",
   inputReferences:[originalId],createdAt:now.toISOString()});
  decisionId=decision.decisionId;
  await new DecisionRepository(Promise.resolve(db),"case-appeal-browser-test-signing-secret").saveDecisionAndProgressCase(decision,f.credentials.admin.accountId);
  const appeals=new CaseAppealService(Promise.resolve(db));
  const submitted=await appeals.submit(f.worker,{caseId:originalId,grounds:"The original decision requires independent reconsideration and reassessment of the retained competency evidence."});
  const secondAdmin="case_appeal_browser_native_admin";
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'case-appeal-browser-admin@example.test','Independent appeal Admin','active','test-unused',$2,$2,$2,$2)",[secondAdmin,now.toISOString()]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[secondAdmin,now.toISOString()]);
  const reviewer=await fundingPrincipal(db,{accountId:secondAdmin},"admin");
  const auth=new AuthAccessRepository(db);
  await auth.authentication.insertSecurityEvent({eventId:"case-appeal-browser-mfa",accountId:reviewer.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:new Date().toISOString()});
  await auth.authentication.insertSecurityEvent({eventId:"case-appeal-browser-login",accountId:reviewer.accountId,eventType:"login_succeeded",activeRole:"admin",metadata:{sessionId:reviewer.sessionId,mfaEventId:"case-appeal-browser-mfa"},occurredAt:new Date().toISOString()});
  const accepted=await appeals.review(reviewer,{appealId:submitted.appealId,version:1,status:"accepted",reason:"Independent review accepts this appeal for an explicitly linked policy-controlled reassessment."});
  appealId=accepted.appealId;
  const framework=(await db.query("SELECT framework_id FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[f.fundingInput.catalogueVersionId])).rows[0].framework_id;
  const alternate="case-appeal-browser-alternate";
  await seedPublishedQuestion(db,{questionId:"assessment_question_"+hash(alternate).slice(0,24),versionId:"question_version_"+hash(alternate+"version").slice(0,24),
   reference:"CASE-APPEAL-BROWSER-ALT",questionType:"MULTIPLE_CHOICE",prompt:"How should a serious hazard be handled?",
   options:["Stop and isolate","Proceed without control"],answerKey:"Stop and isolate",frameworkId:framework,
   fingerprint:hash(alternate+"fingerprint"),authorAccountId:f.credentials.admin.accountId,now:new Date().toISOString()});
 }finally{await db.close()}
 const base="http://127.0.0.1:"+(await port());
 try{
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",base.split(":").at(-1)],probeUrl:base+"/worker/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const page=await browser.newPage();
    await page.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
    await page.getByLabel("Email address").fill(f.credentials.worker.email);
    await page.getByLabel("Password",{exact:true}).fill(f.credentials.worker.password);
    if(f.credentials.worker.totpSecret)await page.getByLabel("Authenticator code").fill(totp(f.credentials.worker.totpSecret));
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await page.waitForURL("**/worker/dashboard",{timeout:25000});
    await page.goto(base+"/worker/case-appeals",{waitUntil:"domcontentloaded"});
    const appeal=page.locator("article[id='"+appealId+"']");
    await appeal.getByText("Status: accepted",{exact:false}).waitFor({timeout:20000});
    await appeal.getByRole("link",{name:"Continue linked reassessment"}).click();
    await page.waitForURL(url=>url.pathname==="/worker/assessment-applications"&&url.searchParams.get("sourceCaseAppealId")===appealId,{timeout:20000});
    await page.getByRole("status").filter({hasText:"Reassessment for appeal"}).waitFor({timeout:20000});
    const offering=page.locator("article.panel").filter({hasText:"Funded safety assessment"}).first();
    await offering.getByRole("button",{name:"Apply — worker pays"}).click();
    await page.waitForURL("**/worker/assessment-applications?status=payment-required",{timeout:25000});
    const pending=page.locator("article.panel").filter({hasText:"Rejected-case appeal reassessment:"}).filter({has:page.getByRole("button",{name:"Confirm sandbox payment"})}).first();
    await pending.getByText(appealId,{exact:true}).waitFor();
    await pending.getByRole("button",{name:"Confirm sandbox payment"}).click();
    await page.waitForURL("**/worker/assessment-applications?status=case-created",{timeout:25000});
    await page.getByText("Funding confirmed. The assessment case is ready.",{exact:true}).waitFor();
    console.log("M21303_WORKER_BROWSER: accepted appeal -> pinned offering -> new worker payment -> funded case");
   }finally{await browser.close()}
  }});
  const proof=new PGlite(f.environment.HSE_PGLITE_DATA_DIR);
  try{
   const sources=(await proof.query("SELECT source.*,apps.assurance_case_id FROM worker_case_appeal_reassessment_sources source JOIN worker_assessment_applications apps USING(application_id) WHERE source_case_appeal_id=$1",[appealId])).rows;
   assert.equal(sources.length,1);
   const source=sources[0];assert.equal(source.source_case_id,originalId);assert.equal(source.source_decision_id,decisionId);
   assert.ok(source.assurance_case_id);assert.notEqual(source.assurance_case_id,originalId);
   const old=(await proof.query("SELECT case_status,decision_reference FROM assurance_cases WHERE case_id=$1",[originalId])).rows[0];
   assert.equal(old.case_status,"Rejected");assert.equal(old.decision_reference,decisionId);
   const fresh=(await proof.query("SELECT case_status,tenant_id,worker_account_id FROM assurance_cases WHERE case_id=$1",[source.assurance_case_id])).rows[0];
   assert.equal(fresh.case_status,"Assessment pending");assert.equal(fresh.tenant_id,source.source_tenant_id);
   assert.equal(fresh.worker_account_id,f.credentials.worker.accountId);
   console.log("M21303_BROWSER_DB: old decision retained, new funded case linked to accepted case appeal");
  }finally{await proof.close()}
 }finally{await f.cleanup()}
});
