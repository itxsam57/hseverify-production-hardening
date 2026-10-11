import { seedPublishedQuestion } from "../helpers/question-publication-fixture.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { configuredPolicy } from "../helpers/interview-policy-config.mjs";

const EMAIL="masterplan.worker.e2e@example.test";
const PHONE="+923001234567";
const PASSWORD="MasterplanWorker!2026";
const SANDBOX_KEY="masterplan-worker-browser-sandbox-2026";
const PNG={name:"proof.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")};
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MCQ_PROMPT="What is the first safe action when an uncontrolled hazard is identified?";
const MCQ_ANSWER="Stop work and isolate the hazard.";
const ASSURANCE_NOTIFICATIONS=process.env.HSE_MASTERPLAN_ASSURANCE_NOTIFICATIONS==="true";
const INTERVIEW_POLICY = process.env.HSE_MASTERPLAN_INTERVIEW_POLICY === "true";
const INTERVIEW_POLICY_MIN_ACTIVE_SECONDS = 15;
const configuredActiveSince = new WeakMap();
const EXPIRY_MODE=process.env.HSE_MASTERPLAN_EXPIRY === "true";
const COMPLETE_REASSESSMENT=process.env.HSE_MASTERPLAN_COMPLETE_REASSESSMENT === "true";
const REPLACED_RESTRICTION="This issuance has been replaced. Verify the current credential shared by the Worker.";
const CONTENT_MODE=process.env.HSE_MASTERPLAN_CONTENT_MODE ?? "COMBINED";
const DELIVERY_MODE=process.env.HSE_MASTERPLAN_DELIVERY_MODE ?? "STRICT";
const WRITTEN_PROMPT="Explain the next safe action after isolating an uncontrolled hazard.";

function stableId(prefix,seed){return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0,24)}`;}
function decodeBase32(value){const clean=value.toUpperCase().replace(/=+$/g,"");let bits="";for(const c of clean)bits+=B32.indexOf(c).toString(2).padStart(5,"0");const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(Number.parseInt(bits.slice(i,i+8),2));return Buffer.from(bytes);}
const lastTotpCounter=new Map();
function totpAt(secret,counter){const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(counter));const digest=createHmac("sha1",decodeBase32(secret)).update(buf).digest(),offset=digest.at(-1)&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,"0");}
async function freshTotp(key,secret){let counter=Math.floor(Date.now()/30000);const last=lastTotpCounter.get(key);if(last!==undefined&&counter<=last){await new Promise(resolve=>setTimeout(resolve,Math.max(100,(last+1)*30000-Date.now()+150)));counter=Math.floor(Date.now()/30000);}lastTotpCounter.set(key,counter);return totpAt(secret,counter);}
async function assertCandidateQuestionBoundary(page) {
  assert.equal(await page.locator('input[name="questionVersionId"]').count(), 0, "Candidate form exposed a bank version ID.");
  assert.equal(/\bMEDIUM\b/.test(await page.locator("main").innerText()), false, "Candidate screen exposed internal difficulty.");
  const html = await page.content();
  assert.equal(/question_version_[A-Za-z0-9_-]{24}|question_[A-Za-z0-9_-]{24}/.test(html), false, "Candidate HTML/RSC exposed bank identifiers.");
}
async function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):!a||typeof a==="string"?reject(new Error("No port")):resolve(a.port));});});}
async function login(page,baseUrl,credential,role){await page.goto(`${baseUrl}/${role}/login`,{waitUntil:"domcontentloaded"});await page.getByLabel("Email address").fill(credential.email);await page.getByLabel("Password").fill(credential.password);if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(await freshTotp(credential.email,credential.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL(`**/${role}/dashboard`,{timeout:30000});}
async function sandboxCode(page,baseUrl,channel,destination){await page.goto(`${baseUrl}/worker/register/sandbox`,{waitUntil:"domcontentloaded"});await page.getByLabel("Delivery channel").selectOption(channel);await page.getByLabel("Delivery destination").fill(destination);await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);await page.getByRole("button",{name:"Open latest sandbox delivery"}).click();const status=page.getByRole("status",{name:"Latest sandbox verification code"});await status.waitFor({timeout:15000});return (await status.locator("strong").innerText()).trim();}
async function uploadIdentity(page,heading,name,document=false){const card=page.getByRole("region",{name:heading,exact:true});if(document){await card.getByLabel("Document type").selectOption("passport");await card.getByLabel("Document number").fill("PK-MASTERPLAN-E2E-001");await card.getByLabel("Issue date").fill("2025-01-01");await card.getByLabel("Expiry date").fill("2035-01-01");}await card.getByLabel("Choose file").setInputFiles({...PNG,name});await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/identity")),card.getByRole("button",{name:"Upload evidence"}).click()]);}
async function approveReview(page,baseUrl,kind,reason){await page.goto(`${baseUrl}/verifier/reviews`,{waitUntil:"domcontentloaded"});const row=page.locator("tbody tr").filter({hasText:kind}).first();await row.getByRole("link",{name:"Review"}).click();await page.getByRole("button",{name:"Claim review"}).click();await page.getByText("ASSIGNED",{exact:true}).waitFor({timeout:15000});await page.getByLabel("Decision").selectOption("APPROVED");await page.getByLabel("Reason", { exact: true }).fill(reason);await page.getByRole("button",{name:"Finalize review"}).click();await page.getByText("APPROVED",{exact:true}).waitFor({timeout:15000});}

async function publishInterviewPolicy(page,baseUrl,credential) {
  await login(page,baseUrl,credential,"admin");
  await page.goto(`${baseUrl}/admin/frameworks`);
  const form=page.locator("form").filter({has:page.getByRole("button",{name:"Publish immutable version"})});
  await form.getByLabel("Framework reference",{exact:true}).fill("E2E-WORKER");
  await form.getByLabel("Policy reference",{exact:true}).fill("E2E-WORKER-POLICY");
  await form.getByLabel("Title",{exact:true}).fill("Approved competency interview policy");
  await form.getByLabel("Effective from",{exact:true}).fill("2026-01-01T00:00");
  await form.getByLabel("Policy values JSON").fill(JSON.stringify({pass_mark:70,...(COMPLETE_REASSESSMENT?{credentialValidityDays:60}:{}),interview:{...configuredPolicy(),minimumActiveSeconds:INTERVIEW_POLICY_MIN_ACTIVE_SECONDS}}));
  await form.getByLabel("Override allowed fields JSON").fill("[]");
  await form.getByLabel("Override directions JSON").fill("{}");
  await form.getByRole("button",{name:"Publish immutable version"}).click();
  await page.getByRole("status").getByText("Immutable policy version published.",{exact:true}).waitFor();
  console.log("ACTUAL_INTERVIEW_ADMIN_BROWSER approved typed JSON policy published before the original Worker application");
}
function extractCredentialPdf(body) {
  assert.match(body.subarray(0,16).toString("ascii"),/^%PDF-\d\.\d/);
  const parsed=spawnSync("pdftotext",["-","-"],{input:body,encoding:"utf8"});
  assert.equal(parsed.status,0,parsed.stderr || "The real PDF text parser failed.");
  return parsed.stdout.replace(/\s+/g," ").trim();
}
async function assertReplacementPublicConsumers(page,baseUrl,credentialId,expected) {
  const response=await page.goto(baseUrl+"/verify/result/"+credentialId,{waitUntil:"domcontentloaded"});
  assert.equal(response?.status(),200);
  await page.getByText("End-to-End Worker Assessment",{exact:true}).waitFor();
  await page.getByText(expected.status==="revoked"?"Revoked":"Valid",{exact:true}).first().waitFor();
  const api=await page.request.get(baseUrl+"/api/credentials/"+credentialId);
  assert.equal(api.status(),200);
  assert.match(api.headers()["cache-control"],/no-store/);
  const result=await api.json();
  assert.equal(result.credentialId,credentialId);assert.equal(result.status,expected.status);
  assert.equal(result.issuedAt,expected.issuedAt);assert.equal(result.expiresAt,expected.expiresAt);
  assert.equal(new Date(result.expiresAt).getTime()-new Date(result.issuedAt).getTime(),60*86400000);
  if(expected.status==="revoked"){
    assert.ok(result.restrictions.includes(REPLACED_RESTRICTION));
    await page.getByText(REPLACED_RESTRICTION,{exact:true}).waitFor();
  }else assert.equal(result.restrictions.includes(REPLACED_RESTRICTION),false);
  const pdf=await page.request.get(baseUrl+"/api/credentials/"+credentialId+"/pdf");
  assert.equal(pdf.status(),200);assert.match(pdf.headers()["content-type"],/application\/pdf/);
  const text=extractCredentialPdf(await pdf.body());
  assert.ok(text.includes("Status: "+expected.status),text);
  assert.ok(text.includes("Expiry: "+expected.expiresAt),text);
  if(expected.status==="revoked")assert.ok(text.includes(REPLACED_RESTRICTION),text);
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByText(expected.status==="revoked"?"Revoked":"Valid",{exact:true}).first().waitFor();
  return result;
}
async function configuredInterviewDuration(page) {
  if (!INTERVIEW_POLICY) return;
  configuredActiveSince.set(page,Date.now());
  await page.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
  for (const label of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"]) {
    await page.getByLabel(label).fill("5");
  }
  await page.getByLabel("Scorecard comments").fill("Controlled complete draft before the published minimum active duration.");
  await page.locator('select[name="recommendation"]').selectOption("PASS");
  for (const input of await page.locator('input[type="checkbox"][name="coveredQuestionId"]').all()) await input.check();
  await page.locator('select[name="safety:live-work"]').selectOption("NOT_OBSERVED");
  await page.getByRole("button",{name:"Save draft"}).click();
  await page.getByRole("button",{name:"End interview"}).click();
  await page.getByRole("alert").filter({hasText:/active.*seconds|duration/i}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Submit final recommendation"}).isDisabled(),true);
  await page.getByRole("tab",{name:"Questions",exact:true}).click();
  console.log("ACTUAL_INTERVIEW_DURATION_BROWSER End denied before the Admin-published minimum without closing the interview");
}
async function waitConfiguredActiveMinimum(page) {
  if (!INTERVIEW_POLICY) return;
  const since=configuredActiveSince.get(page);
  assert.ok(since,"Configured interview active interval was not observed.");
  const remaining=(INTERVIEW_POLICY_MIN_ACTIVE_SECONDS+1)*1000-(Date.now()-since);
  if (remaining>0) await new Promise(resolve=>setTimeout(resolve,remaining));
}
async function configuredInterviewCoverage(page,{denyIncomplete=false}={}) {
  if (!INTERVIEW_POLICY) return;
  if (denyIncomplete) {
    for (const input of await page.locator('input[type="checkbox"][name="coveredQuestionId"]').all()) await input.uncheck();
    await page.getByRole("button",{name:"Save draft"}).click();
    await page.getByRole("button",{name:"End interview"}).click();
    await page.getByRole("alert").filter({hasText:/coverage.*mandatory|mandatory.*coverage/i}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Submit final recommendation"}).isDisabled(),true);
    await page.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
    console.log("ACTUAL_INTERVIEW_COVERAGE_BROWSER End denied incomplete configured coverage without closing the interview");
  }
  const coverage=page.locator('input[type="checkbox"][name="coveredQuestionId"]');
  assert.ok(await coverage.count()>=4,"Mandatory, high-risk, randomized and approved follow-up questions were not selected.");
  for (const input of await coverage.all()) await input.check();
  await page.locator('select[name="safety:live-work"]').selectOption("NOT_OBSERVED");
}

async function seedIndependentAppealAdmin(database,pepper) {
  const credential={accountId:"account_masterplan_independent_appeal_admin",email:"masterplan.independent.appeal@example.test",password:"IndependentAppeal!Password2026",totpSecret:"JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"};
  const now=new Date().toISOString(),salt=randomBytes(16);
  const passwordKey=scryptSync(credential.password+"\u0000"+pepper,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  const passwordHash=["scrypt",16384,8,1,salt.toString("base64url"),passwordKey.toString("base64url")].join("$");
  const iv=randomBytes(12),key=createHmac("sha256",pepper).update("hse-auth-encryption-v1").digest();
  const cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.from("hse-auth-secret-v1"));
  const encrypted=Buffer.concat([cipher.update(credential.totpSecret,"utf8"),cipher.final()]);
  const encryptedSecret=["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),encrypted.toString("base64url")].join(".");
  await database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,'Independent appeal Admin','active',$3,$4,$4,$4,$4)",[credential.accountId,credential.email,passwordHash,now]);
  await database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[credential.accountId,now]);
  await database.query("INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at) VALUES($1,$2,'totp',$3,'active',NULL,$4,$4)",["mfa_masterplan_independent_appeal",credential.accountId,encryptedSecret,now]);
  return credential;
}

async function phaseOne(baseUrl,environment,credentials){
  return runDevelopmentServer({
    args:["--hostname","127.0.0.1","--port",String(new URL(baseUrl).port)],probeUrl:`${baseUrl}/worker/register`,projectRoot:process.cwd(),environment,
    probe:async()=>{
      const browser=await chromium.launch({headless:true});
      const workerContext=await browser.newContext({viewport:{width:1440,height:1000},permissions:["clipboard-read","clipboard-write"]});
      const verifierContext=await browser.newContext({viewport:{width:1440,height:1000}});
      const worker=await workerContext.newPage(), verifier=await verifierContext.newPage();
      try{
        await worker.goto(`${baseUrl}/worker/register`,{waitUntil:"domcontentloaded"});
        await worker.getByLabel("Full name").fill("Masterplan Worker");
        await worker.getByLabel("Email address").fill(EMAIL);await worker.getByLabel("Mobile phone").fill(PHONE);
        await worker.getByLabel("Create password").fill(PASSWORD);await worker.getByLabel("Confirm password").fill(PASSWORD);
        await worker.getByLabel("Country", { exact: true }).fill("Pakistan");
        await worker.getByLabel("I accept the HSE Verify terms for this Worker account.", { exact: true }).check();
        await worker.getByLabel("I accept the privacy notice for Worker registration data.", { exact: true }).check();
        await worker.getByRole("button",{name:"Create Worker account"}).click();
        try {
          await worker.waitForURL(/\/worker\/register\/verify/,{timeout:15000});
        } catch (error) {
          console.error("Worker signup returned", worker.url(), await worker.locator("body").innerText());
          console.error("Worker signup field state", await worker.locator("form").first().evaluate(form => Array.from(form.elements).filter(field => field.name && !/password/i.test(field.name)).map(field => ({ name: field.name, value: field.value, checked: field.checked }))));
          throw error;
        }
        const emailCode=await sandboxCode(worker,baseUrl,"email",EMAIL);
        await worker.goto(`${baseUrl}/worker/register/verify`,{waitUntil:"domcontentloaded"});
        await worker.getByLabel("Verification code").fill(emailCode);
        await worker.getByRole("button",{name:"Verify email"}).click();
        await worker.getByText("Step 2 of 2: phone",{exact:true}).waitFor({timeout:15000});
        const phoneCode=await sandboxCode(worker,baseUrl,"phone",PHONE);
        await worker.goto(`${baseUrl}/worker/register/verify`,{waitUntil:"domcontentloaded"});
        await worker.getByLabel("Verification code").fill(phoneCode);
        await worker.getByRole("button",{name:"Verify phone"}).click();
        await worker.waitForURL(/\/worker\/register\/verify\?stage=complete/,{timeout:15000});
        await worker.getByRole("link",{name:"Worker sign-in",exact:true}).click();await worker.getByLabel("Email address").fill(EMAIL);await worker.getByLabel("Password").fill(PASSWORD);await worker.getByRole("button",{name:"Sign in",exact:true}).click();await worker.waitForURL(/\/worker\/(dashboard|onboarding)/,{timeout:15000});

        const unverifiedApplications = await worker.goto(`${baseUrl}/worker/assessment-applications`);assert.equal(unverifiedApplications?.status(),200);await worker.getByRole("heading",{name:"No eligible assessment applications"}).waitFor();
        await worker.goto(`${baseUrl}/worker/profile?section=personal`);await worker.getByLabel("Legal first name").fill("Masterplan");await worker.getByLabel("Legal last name").fill("Worker");await worker.getByLabel("Preferred name").fill("MP");await worker.getByLabel("Date of birth").fill("1990-01-15");await worker.getByLabel("Nationality").fill("Pakistani");await worker.getByLabel("Country of residence").fill("Pakistan");await worker.getByLabel("Primary language").fill("English");await worker.getByRole("button",{name:"Save and continue"}).click();
        await worker.getByLabel("Country code").fill("+92");await worker.getByLabel("Phone number").fill("3001234567");await worker.getByLabel("Address line 1").fill("1 Safety Street");await worker.getByLabel("City").fill("Lahore");await worker.getByLabel("Region or province").fill("Punjab");await worker.getByLabel("Postal code").fill("54000");await worker.getByRole("button",{name:"Save and continue"}).click();
        await worker.getByLabel("Primary occupation or trade").fill("Safety Officer");await worker.getByLabel("Years of experience").fill("7");await worker.getByLabel("Current employment status").selectOption("employed");await worker.getByLabel("Preferred work countries").fill("Pakistan, Saudi Arabia");await worker.getByRole("button",{name:"Save changes"}).click();await worker.reload();await worker.getByRole("button",{name:"Submit profile"}).click();await worker.getByText("Profile submitted",{exact:true}).waitFor({timeout:15000});

        await worker.goto(`${baseUrl}/worker/identity`);await worker.getByLabel("Legal first name").fill("Masterplan");await worker.getByLabel("Legal last name").fill("Worker");await worker.getByLabel("Date of birth").fill("1990-01-15");await worker.getByLabel("Nationality").fill("Pakistani");await worker.getByLabel("Country of residence").fill("Pakistan");await worker.getByRole("button",{name:"Save identity details"}).click();await worker.reload();
        await uploadIdentity(worker,"Identity document","passport.png",true);await uploadIdentity(worker,"Profile photo","profile.png");await uploadIdentity(worker,"Selfie evidence","selfie.png");await worker.reload();await worker.getByRole("button",{name:"Submit identity"}).click();await worker.getByText("Manual review",{exact:true}).first().waitFor({timeout:15000});

        await worker.goto(`${baseUrl}/worker/evidence`);await worker.getByLabel("Record type").selectOption("qualification");await worker.getByRole("button",{name:"Create draft"}).click();await worker.reload();
        const article=worker.locator("article").filter({hasText:"Qualification record"}).first();await article.getByLabel("Qualification title").fill("Masterplan Safety Certificate");await article.getByLabel("Category").fill("Occupational Safety");await article.getByLabel("Issuing organization").fill("HSE Institute");await article.getByLabel("Certificate / candidate number").fill("MP-E2E-001");await article.getByLabel("Level").fill("Level 3");await article.getByLabel("Issue date").fill("2025-01-01");await article.getByLabel("Country").fill("Pakistan");await article.getByLabel("I confirm these qualification details").check();await article.getByRole("button",{name:"Save metadata"}).click();await worker.reload();
        const q=worker.locator("article").filter({hasText:"Qualification record"}).first();await q.getByLabel("Primary certificate file").setInputFiles({...PNG,name:"certificate.png"});await q.getByRole("button",{name:"Upload file"}).click();await worker.reload();await worker.locator("article").filter({hasText:"Qualification record"}).first().getByRole("button",{name:"Submit this version"}).click();

        await login(verifier,baseUrl,credentials.verifier,"verifier");
        await approveReview(verifier,baseUrl,"identity","Identity evidence and submitted details are consistent.");
        await approveReview(verifier,baseUrl,"qualification","Qualification evidence is attributable and verified.");
        await worker.goto(`${baseUrl}/worker/identity`);await worker.getByText("Verified",{exact:true}).first().waitFor({timeout:15000});
        const permanentWorkerId=(await worker.locator("main").getByText(/^worker_id_[A-Za-z0-9_-]{24}$/).first().innerText()).trim();
        assert.match(permanentWorkerId,/^worker_id_/);
        return {permanentWorkerId};
      } finally {await workerContext.close();await verifierContext.close();await browser.close();}
    }
  });
}

async function assertReviewUnavailable(context,baseUrl,attemptId,position) {
  const page=await context.newPage();
  try {
    await page.goto(`${baseUrl}/worker/assessments/${attemptId}/review/${position}`);
    await page.getByRole("heading",{name:"The requested record could not be shown.",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Save revised answer",exact:true}).count(),0,"Denied assessment review exposed candidate editing");
  } finally {await page.close();}
}

async function reviseCommittedAnswer(page,baseUrl,attemptId,position) {
  console.log(`JOURNEY: ${DELIVERY_MODE} question ${position} revision and flagging`);
  await page.getByRole("link",{name:`Question ${position}`,exact:true}).click();
  await page.getByRole("heading",{name:`Review question ${position}`,exact:true}).waitFor();
  await assertCandidateQuestionBoundary(page);
  if(position===1) await page.getByLabel(MCQ_ANSWER).check();
  else await page.getByLabel("Your answer").fill("Stop work, verify the isolated hazard is controlled, document controls, and only restart after confirming the area is safe.");
  await page.getByRole("button",{name:"Save revised answer",exact:true}).click();
  await page.getByText(/revision 1 is currently effective/i).waitFor();
  await page.getByRole("button",{name:"Flag for review",exact:true}).click();
  await page.getByRole("button",{name:"Remove review flag",exact:true}).waitFor();
  await page.getByRole("button",{name:"Remove review flag",exact:true}).click();
  await page.getByRole("button",{name:"Flag for review",exact:true}).waitFor();
  await page.getByRole("link",{name:"Return to assessment",exact:true}).click();
}

async function seedAssessment(database,credentials){
  const now=new Date().toISOString(), admin=credentials.admin.accountId, assessor=credentials.assessor.accountId;
  const frameworkId=stableId("framework","masterplan-worker-e2e"), blueprintId=stableId("assessment_blueprint","masterplan-worker-e2e"), blueprintVersionId=stableId("blueprint_version","masterplan-worker-e2e"), catalogueId=stableId("assessment_catalogue","masterplan-worker-e2e"), catalogueVersionId=stableId("catalogue_version","masterplan-worker-e2e");
  const policyId=stableId("policy","masterplan-worker-e2e"),policyVersionId=stableId("policy_version","masterplan-worker-e2e");
  await database.query(`INSERT INTO assurance_frameworks(framework_id,framework_reference,title,framework_status,created_by_account_id,created_at,updated_at) VALUES($1,'E2E-WORKER','End-to-End Worker Framework','ACTIVE',$2,$3,$3)`,[frameworkId,admin,now]);
  if (!INTERVIEW_POLICY) {
  await database.query(`INSERT INTO assurance_policy_packs(policy_id,framework_id,policy_reference,title,policy_status,created_by_account_id,created_at,updated_at) VALUES($1,$2,'E2E-WORKER-POLICY','End-to-End Worker Policy','ACTIVE',$3,$4,$4)`,[policyId,frameworkId,admin,now]);
  await database.query(`INSERT INTO assurance_policy_versions(policy_version_id,policy_id,version_no,version_status,effective_from,effective_to,policy_values,override_allowed_fields,override_directions,created_by_account_id,created_at) VALUES($1,$2,1,'PUBLISHED','2026-01-01T00:00:00Z',NULL,$3::jsonb,'[]'::jsonb,'{}'::jsonb,$4,$5)`,[policyVersionId,policyId,JSON.stringify({pass_mark:70,...(COMPLETE_REASSESSMENT?{credentialValidityDays:60}:{})}),admin,now]);
  }
  await database.query(`INSERT INTO assessment_blueprints(blueprint_id,blueprint_reference,blueprint_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'BP-E2E-WORKER','INACTIVE',NULL,$2,$3,$3)`,[blueprintId,admin,now]);
  await database.query(`INSERT INTO assessment_blueprint_versions(blueprint_version_id,blueprint_id,version_no,framework_id,title,selectors_json,created_by_account_id,created_at) VALUES($1,$2,1,$3,'End-to-End Worker Blueprint',$4::jsonb,$5,$6)`,[blueprintVersionId,blueprintId,frameworkId,JSON.stringify([{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:[]},{count:1,questionType:"SHORT_TEXT",tagsAll:[]}].filter(selector=>CONTENT_MODE==="COMBINED" || selector.questionType===(CONTENT_MODE==="MCQ_ONLY" ? "MULTIPLE_CHOICE" : "SHORT_TEXT"))),admin,now]);
  await database.query("UPDATE assessment_blueprints SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3 WHERE blueprint_id=$1",[blueprintId,blueprintVersionId,now]);
  await database.query(`INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,section_config_json,require_fullscreen,require_environment_declaration,require_monitoring_consent,timing_config_json) VALUES($1,$2,$3::jsonb,FALSE,TRUE,TRUE,$4::jsonb)`,[blueprintVersionId,DELIVERY_MODE,JSON.stringify(DELIVERY_MODE==="SECTION_REVIEW" ? [{title:"Objective section",endPosition:1},{title:"Written section",endPosition:2}] : []),process.env.HSE_MASTERPLAN_TIMING === "true" ? JSON.stringify({mode:"COMBINED",durationSeconds:EXPIRY_MODE ? 60 : 1200}) : null]);
  await database.query(`INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'CAT-E2E-WORKER','INACTIVE',NULL,$2,$3,$3)`,[catalogueId,admin,now]);
  await database.query(`INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'End-to-End Worker Assessment','Preserved Masterplan Worker journey',$3,$4,1,$5,$6)`,[catalogueVersionId,catalogueId,frameworkId,blueprintVersionId,admin,now]);
  await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE',updated_at=$3 WHERE catalogue_entry_id=$1",[catalogueId,catalogueVersionId,now]);
  for(const [seed,type,prompt,answer,rubric] of [["mcq","MULTIPLE_CHOICE",MCQ_PROMPT,MCQ_ANSWER,null],["written","SHORT_TEXT",WRITTEN_PROMPT,null,{maxScore:100,criteria:[{description:"Identifies controlled verification before restart",points:100}]}]]){
    const qid=stableId("assessment_question",`masterplan-${seed}`),vid=stableId("question_version",`masterplan-${seed}`),fp=createHash("sha256").update(`${type}:${prompt}`).digest("hex");
    await seedPublishedQuestion(database,{questionId:qid,versionId:vid,reference:`E2E-Q-${seed.toUpperCase()}`,questionType:type,prompt,options:type==="MULTIPLE_CHOICE"?[MCQ_ANSWER,"Continue working and report later."]:null,answerKey:answer,rubric,frameworkId,domainReference:"Hazard Control",difficulty:"MEDIUM",tags:[],fingerprint:fp,authorAccountId:admin,now});
  }
  if(process.env.HSE_MASTERPLAN_RECOVERY_MODE === "replacement") {
    for(const [seed,type,prompt] of [["spare-mcq","MULTIPLE_CHOICE",MCQ_PROMPT+" Replacement bank variant."],["spare-written","SHORT_TEXT",WRITTEN_PROMPT+" Replacement bank variant."]]) {
      const qid=stableId("assessment_question",seed),vid=stableId("question_version",seed),fp=createHash("sha256").update(prompt).digest("hex");
      const source=(await database.query("SELECT * FROM assessment_question_versions WHERE question_type=$1 LIMIT 1",[type])).rows[0];
      await seedPublishedQuestion(database,{questionId:qid,versionId:vid,reference:seed,questionType:type,prompt,options:source.options_json,answerKey:source.answer_key_json,rubric:source.rubric_json,frameworkId:source.framework_id,domainReference:source.domain_reference,difficulty:source.difficulty,tags:source.tags_json,fingerprint:fp,authorAccountId:admin,now});
    }
  }
  await database.query("UPDATE assessor_assignment_profiles SET profile_status='PAUSED' WHERE assessor_account_id<>$1",[assessor]);
  await database.query(`INSERT INTO assessor_assignment_profiles(assessor_account_id,trade_scopes,qualification_scopes,languages,jurisdictions,risk_levels,availability_json,max_active_interviews,profile_status,updated_at) VALUES($1,'["*"]'::jsonb,'["*"]'::jsonb,'["*"]'::jsonb,'["*"]'::jsonb,'["*"]'::jsonb,'{}'::jsonb,8,'ACTIVE',$2) ON CONFLICT(assessor_account_id) DO UPDATE SET profile_status='ACTIVE',trade_scopes='["*"]'::jsonb,qualification_scopes='["*"]'::jsonb,languages='["*"]'::jsonb,jurisdictions='["*"]'::jsonb,risk_levels='["*"]'::jsonb,updated_at=$2`,[assessor,now]);
  await database.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,created_at) VALUES($1,$2,'assessor','E2E-WORKER','CURRENT','2026-01-01T00:00:00Z','2027-12-31T00:00:00Z','Current framework calibration for preserved E2E interview matching.',$3,$4)`,[stableId("staff_calibration","masterplan-worker-e2e"),assessor,admin,now]);
  return {catalogueVersionId};
}


async function verifyAssuranceNotificationConsumers({root,dbDir,baseUrl,port,env,credentials,workerAccountId,journeyCaseId}){
 const {openScriptDatabase}=await import("../../scripts/lib/database.mjs");
 const {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment}=await import("../helpers/worker-registration-runtime-loader.mjs");
 const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
 const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
 const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:dbDir});
 let records,emailStatuses;
 try{
  setWorkerRegistrationRuntimeEnvironment({registrationOtpProviders:{},publicBaseUrl:baseUrl});
  const repo=new DatabaseOutboxRepository(Promise.resolve(db));
  let examined=0;
  for(;examined<100;examined++){
   const processed=await processNextOutboxJob({database:db,repository:repo});
   if(!processed)break;
   if(processed.jobType==="notification.assurance.event")assert.equal(processed.status,"succeeded","The actual registered assurance projector must complete.");
   if(processed.jobType==="email.assurance.event"){
    assert.ok(["succeeded","retry_wait","terminal_failed"].includes(processed.status));
    assert.notEqual(processed.lastErrorCode,"handler_exception","The registered fixed email handler must run.");
   }
  }
  assert.ok(examined<100,"The owned fixture queue exceeded the bounded registered worker run.");
  const sourceCase=(await db.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1 AND worker_account_id=$2",[journeyCaseId,workerAccountId])).rows[0];
  assert.ok(sourceCase?.credential_reference);
  const appeal=(await db.query("SELECT appeal_id FROM credential_appeals WHERE credential_id=$1 ORDER BY created_at DESC LIMIT 1",[sourceCase.credential_reference])).rows[0];
  assert.ok(appeal);
  records=(await db.query("SELECT DISTINCT ON(notification_type) notification_id,notification_type,target_key,target_reference,read_at "+
   "FROM platform_notifications WHERE recipient_account_id=$1 AND recipient_role='worker' "+
   "AND ((notification_type='decision.recorded' AND target_reference=$2) OR "+
    "(notification_type='credential.issued' AND target_reference=$3) OR "+
    "(notification_type='appeal.updated' AND target_reference=$4)) ORDER BY notification_type,notification_sequence DESC",
    [workerAccountId,journeyCaseId,sourceCase.credential_reference,appeal.appeal_id])).rows;
  for(const type of ["decision.recorded","credential.issued","appeal.updated"])assert.ok(records.some(row=>row.notification_type===type),"Original "+type+" producer was not projected.");
  assert.notEqual(credentials.worker.accountId,workerAccountId,"Foreign browser denial must use the separate real seeded Worker.");
  emailStatuses=(await db.query("SELECT delivery_type,status,last_result_code,delivered_at FROM platform_email_deliveries "+
   "WHERE recipient_account_id=$1 AND delivery_type IN ('evidence.submitted','evidence.reviewed','decision.recorded','credential.issued','appeal.submitted','appeal.updated') ORDER BY delivery_sequence DESC",[workerAccountId])).rows;
  assert.ok(emailStatuses.length>=5);
  assert.ok(emailStatuses.every(row=>["retry_wait","suppressed","terminal_failed"].includes(row.status) && row.delivered_at===null),"Empty provider configuration cannot claim provider acceptance or delivery.");
  console.log("ACTUAL_ASSURANCE_WORKER_DB",JSON.stringify({examined,types:records.map(r=>r.notification_type),emailStatuses:emailStatuses.map(r=>({type:r.delivery_type,status:r.status,code:r.last_result_code}))}));
 }finally{setWorkerRegistrationRuntimeEnvironment(undefined);await db.close();}
 const proof=await runDevelopmentServer({
  args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment:env,
  probe:async()=>{
   const browser=await chromium.launch({headless:true});
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),worker=await context.newPage();
   try{
    await login(worker,baseUrl,{email:EMAIL,password:PASSWORD},"worker");
    for(const type of ["decision.recorded","credential.issued","appeal.updated"]){
     const record=records.find(row=>row.notification_type===type);
     await worker.goto(baseUrl+"/worker/notifications",{waitUntil:"domcontentloaded"});
     const item=worker.locator(".notification-center-item").filter({has:worker.locator('input[name="notificationId"][value="'+record.notification_id+'"]')});
     assert.equal(await item.count(),1);
     await item.getByRole("button",{name:"Open",exact:true}).click();
     const expected=type==="decision.recorded"?"/worker/assurance-cases/"+record.target_reference:
      type==="credential.issued"?"/worker/passport#"+record.target_reference:"/worker/appeals#"+record.target_reference;
     await worker.waitForURL(baseUrl+expected,{timeout:20000});
     if(type==="decision.recorded"){
      await worker.getByRole("heading",{name:"Assurance case",exact:true}).waitFor();
      await worker.getByText("Case: "+record.target_reference,{exact:true}).waitFor();
     }else await worker.locator('[id="'+record.target_reference+'"]').waitFor();
     console.log("ACTUAL_ASSURANCE_NOTIFICATION_OPEN",type,expected);
    }
    await worker.goto(baseUrl+"/worker/notifications",{waitUntil:"domcontentloaded"});
    const emailPanel=worker.locator("section").filter({has:worker.getByRole("heading",{name:"Email delivery",exact:true})});
    await emailPanel.getByText("Your recent portal email updates.",{exact:true}).waitFor();
    assert.equal(await emailPanel.getByText("Delivered",{exact:true}).count(),0);
    assert.equal(await emailPanel.getByText("Sent",{exact:true}).count(),0);
    assert.ok(await emailPanel.locator(".email-delivery-item").count()>0);
    assert.ok(await emailPanel.getByText(/Retrying|Suppressed|Failed|Confirmation unavailable/,{exact:true}).count()>0);
    const foreignContext=await browser.newContext({viewport:{width:1440,height:1000}}),foreignWorker=await foreignContext.newPage();
    try{
     await login(foreignWorker,baseUrl,credentials.worker,"worker");
     const denied=await foreignWorker.goto(baseUrl+"/worker/assurance-cases/"+journeyCaseId,{waitUntil:"domcontentloaded"});
     assert.equal(denied.status(),404,"A different real Worker cannot access the notification recipient\'s owned case.");
     assert.equal((await foreignWorker.locator("main").innerText()).includes(journeyCaseId),false);
    }finally{await foreignContext.close();}
    return {code:0,signal:"SMOKE_COMPLETE"};
   }finally{await context.close();await browser.close();}
  }
 });
 assert.equal(proof.requestedSignal,"SMOKE_COMPLETE");
 const retained=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:dbDir});
 try{
  const read=(await retained.query("SELECT notification_id,read_at FROM platform_notifications WHERE notification_id=ANY($1::text[])",[records.map(row=>row.notification_id)])).rows;
  assert.ok(read.length>=3);assert.ok(read.every(row=>row.read_at!==null),"Real Open action must retain the one-way read timestamp.");
 }finally{await retained.close();}
 console.log("ACTUAL_ASSURANCE_NOTIFICATION_BROWSER original retained sources, registered worker, owned Open/read and foreign denial passed");
}

test("Masterplan preserved Worker journey: register to credential, share and appeal on one record",{timeout:420000},async()=>{
  const companyFunded=process.env.HSE_MASTERPLAN_FUNDING_MODE === "company";
  const root=process.cwd(),dbDir=await mkdtemp(join(tmpdir(),"hse-masterplan-worker-e2e-")),port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
  const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dbDir,HSE_RELEASE_SHA:"masterplan-worker-e2e",HSE_CREDENTIAL_SIGNING_SECRET:"synthetic-masterplan-worker-signing-secret-2026",HSE_SESSION_SECRET:"masterplan-worker-e2e-session-secret-2026-more-than-32",HSE_AUTH_PEPPER:"masterplan-worker-e2e-auth-pepper-2026-more-than-32",HSE_ENABLE_AUTH_SANDBOX:"true",HSE_AUTH_SANDBOX_ACCESS_KEY:SANDBOX_KEY,HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  try{
    const migration=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{cwd:root,env,encoding:"utf8"});assert.equal(migration.status,0,migration.stderr||migration.stdout);
    const seed=spawnSync(process.execPath,["scripts/independent-audit-seed.mjs"],{cwd:root,env,encoding:"utf8"});assert.equal(seed.status,0,seed.stderr||seed.stdout);
    const credentials=JSON.parse(await readFile(process.env.HSE_AUDIT_CREDENTIALS_PATH ?? "/tmp/independent-audit-credentials.json","utf8"));
    const phase1=await phaseOne(baseUrl,env,credentials);console.log("JOURNEY: identity and evidence verified");assert.equal(phase1.requestedSignal,"SMOKE_COMPLETE");
    const db=new PGlite(dbDir);
    let workerAccountId,permanentWorkerId,companyTenantId;
    try{
      workerAccountId=(await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[EMAIL])).rows[0]?.account_id;
      permanentWorkerId=(await db.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",[workerAccountId])).rows[0]?.permanent_worker_id;
      assert.ok(workerAccountId);assert.match(permanentWorkerId,/^worker_id_/);
      await seedAssessment(db,credentials);
      credentials.appealAdmin=await seedIndependentAppealAdmin(db,env.HSE_AUTH_PEPPER);
      assert.notEqual(credentials.appealAdmin.accountId,credentials.admin.accountId);
      companyTenantId=(await db.query("SELECT tenant_id FROM auth_tenant_memberships WHERE account_id=$1",[credentials.company.accountId])).rows[0].tenant_id;
      if(companyFunded)await db.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,worker_accepted_at,activated_at,created_at,updated_at) VALUES($1,$2,$3,$4,'permanent_worker_id','active',NOW(),NOW(),NOW(),NOW())`,[stableId("company_worker_link","funded-masterplan-worker"),companyTenantId,workerAccountId,permanentWorkerId]);
    } finally {await db.close();}

    let journeyCaseId=null;
    const journeyTenantId=companyFunded ? companyTenantId : "tenant_independent_worker_scope";
    const phase2=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:`${baseUrl}/worker/login`,projectRoot:root,environment:env,
      probe:async({output})=>{
        const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
        const workerContext=await browser.newContext({viewport:{width:1440,height:1000},permissions:["camera","microphone"]});
        const verifierContext=await browser.newContext({viewport:{width:1440,height:1000}});
        const assessorContext=await browser.newContext({viewport:{width:1440,height:1000},permissions:["camera","microphone"]});
        const companyContext=await browser.newContext({viewport:{width:1440,height:1000}});
        const company=await companyContext.newPage();
        const adminContext=await browser.newContext({viewport:{width:1440,height:1000}});
        const worker=await workerContext.newPage(),verifier=await verifierContext.newPage(),assessor=await assessorContext.newPage(),admin=await adminContext.newPage();
        const errors=[];for(const p of [worker,verifier,assessor,admin]){p.on("pageerror",e=>errors.push(e.message));p.on("console",m=>{if(m.type()==="error")errors.push(m.text());});}
        try{
          if (INTERVIEW_POLICY) await publishInterviewPolicy(admin,baseUrl,credentials.admin);
          await login(worker,baseUrl,{email:EMAIL,password:PASSWORD},"worker");
          await worker.goto(`${baseUrl}/worker/assessment-applications`,{waitUntil:"domcontentloaded"});
          await worker.getByRole("heading",{name:"End-to-End Worker Assessment"}).first().waitFor({timeout:20000});
          if(companyFunded){
            await worker.getByLabel("Funding Company").selectOption({label:"Independent Audit Company"});
            await worker.getByRole("button",{name:"Request 1 assessment credit"}).click();
            await worker.getByText("Company funding request submitted.",{exact:true}).waitFor({timeout:20000});
            await login(company,baseUrl,credentials.company,"company");
            await company.goto(`${baseUrl}/company/billing`);
            await company.locator("tr").filter({hasText:workerAccountId}).getByRole("button",{name:"Approve",exact:true}).click();
            await company.getByRole("alert").getByText("The Company does not have enough unreserved assessment credits.",{exact:true}).waitFor({timeout:20000});
            await company.getByLabel("Credits",{exact:true}).fill("1");
            await company.getByLabel("Amount (minor units)",{exact:true}).first().fill("100");
            await company.getByRole("button",{name:"Create sandbox checkout"}).click();
            await company.getByRole("button",{name:"Complete sandbox checkout"}).click();
            await company.getByText("Captured",{exact:true}).waitFor({timeout:20000});
            await company.locator("tr").filter({hasText:workerAccountId}).getByRole("button",{name:"Approve",exact:true}).click();
            await company.locator("tr").filter({hasText:workerAccountId}).getByText("APPROVED",{exact:true}).waitFor({timeout:20000});
            await worker.reload();
            await worker.getByText("Status: CASE CREATED",{exact:true}).waitFor({timeout:20000});
          } else {
          await worker.getByRole("button",{name:"Apply — worker pays"}).click();
          await worker.getByText("Application created. Complete the sandbox self-payment confirmation to fund the assessment.",{exact:true}).waitFor({timeout:20000});
          await worker.getByRole("button",{name:"Confirm sandbox payment"}).click();
          await worker.getByText("Funding confirmed. The assessment case is ready.",{exact:true}).waitFor({timeout:20000});
          }
          console.log("JOURNEY: funded assessment case created");
          journeyCaseId=(await worker.locator("main").getByText(/^assurance_case_[A-Za-z0-9_-]{24}$/).first().innerText()).trim();
          assert.match(journeyCaseId,/^assurance_case_[A-Za-z0-9_-]{24}$/);
          if(process.env.HSE_MASTERPLAN_TIMING === "true") {
            await worker.goto(baseUrl+"/worker/privacy");
            await worker.getByLabel("Accommodation request").fill("Timing delivery verification");
            await worker.getByRole("button",{name:"Submit accommodation",exact:true}).click();
            await worker.getByText("Timing delivery verification",{exact:true}).waitFor();
            await login(admin,baseUrl,credentials.admin,"admin");
            await admin.goto(baseUrl+"/admin/privacy");
            const accommodation=admin.locator("article").filter({hasText:"Timing delivery verification"}).first();
            await accommodation.getByLabel("Assurance Case").selectOption(journeyCaseId);
            await accommodation.getByLabel("Time multiplier").fill("1.5");
            await accommodation.getByLabel("Extra break minutes").fill("0");
            await accommodation.getByLabel("Review reason").fill("Approved extra assessment time without changing competency standards.");
            await accommodation.getByRole("button",{name:"Save accommodation decision",exact:true}).click();
            await accommodation.getByText("Status: APPROVED",{exact:true}).waitFor();
            await worker.goto(baseUrl+"/worker/assessment-applications");
          }
          await worker.getByRole("link",{name:"Continue to available assessments"}).click();
          await worker.waitForURL("**/worker/available-assessments",{timeout:20000});
          const eligibleHeading=worker.getByRole("region",{name:"Eligible assessment offerings"}).getByRole("heading",{name:"End-to-End Worker Assessment"});
          try {
            await eligibleHeading.waitFor({timeout:20000});
          } catch (error) {
            throw new Error("Available-assessments page did not expose the funded case. URL="+worker.url()+"\nBODY:\n"+await worker.locator("body").innerText(),{cause:error});
          }
          await worker.getByRole("button",{name:"Start assessment"}).click();await worker.waitForURL(/\/precheck\?/,{timeout:15000});
          await worker.getByRole("button",{name:"Run device checks"}).click();await worker.getByText("Device checks completed.",{exact:true}).waitFor({timeout:15000});await worker.getByLabel("I confirm I am the Worker assigned to this assessment.").check();await worker.getByLabel(/I confirm my environment is suitable/).check();await worker.getByLabel(/I consent to the monitoring signals/).check();await worker.getByRole("button",{name:"Begin assessment"}).click();await worker.waitForURL(/\/worker\/assessments\/assessment_attempt_/,{timeout:20000});
          let attemptId=worker.url().split("/").pop();const originalAttemptId=attemptId;
          if(process.env.HSE_MASTERPLAN_TIMING === "true") {
            const timer=worker.getByRole("timer",{name:"Assessment time remaining"});
            await timer.waitFor();
            const remaining = text => {const match=text.match(/(\d+):(\d+) remaining/);assert.ok(match);return Number(match[1])*60+Number(match[2]);};
            const before=remaining(await timer.innerText());assert.ok(before>=(EXPIRY_MODE ? 60 : 1770) && before<=(EXPIRY_MODE ? 90 : 1800),"Approved1.5 extra time was not applied.");
            await worker.reload();await timer.waitFor();const after=remaining(await timer.innerText());assert.ok(after<=before && after>=before-15,"Reload reset the assessment clock.");
            console.log("ACTUAL_WORKER_TIMING_BROWSER approved multiplier, adjusted"+(EXPIRY_MODE ? "90" : "1800")+"s timer retained after reload");
          }

          if(EXPIRY_MODE) {
            if(CONTENT_MODE==="WRITTEN_ONLY") await worker.getByLabel("Your answer").fill("Draft response retained at written-only natural expiry.");
            else await worker.getByLabel(MCQ_ANSWER).check();
            await worker.getByText("Saved",{exact:true}).first().waitFor({timeout:15000});
            await worker.getByText("Assessment submitted",{exact:true}).waitFor({timeout:110000});
            assert.equal(await worker.getByRole("timer").count(),0);
            assert.equal(await worker.getByLabel(MCQ_ANSWER).count(),0);
            await worker.reload();
            await worker.getByText("Assessment submitted",{exact:true}).waitFor();
            console.log("ACTUAL_EXPIRY_BROWSER saved draft retained, natural server deadline receipt, reload remains submitted");
            if(CONTENT_MODE==="MCQ_ONLY") return {attemptId};
            await login(verifier,baseUrl,credentials.verifier,"verifier");
            await verifier.goto(`${baseUrl}/verifier/reviews/scoring`);
            let review=verifier.locator("tbody tr").filter({hasText:journeyCaseId}).first();
            await review.getByText(WRITTEN_PROMPT,{exact:false}).waitFor();
            if(CONTENT_MODE==="WRITTEN_ONLY") {
              await review.getByText("Draft response retained at written-only natural expiry.",{exact:true}).waitFor();
              assert.equal(await review.locator("article").count(),1);
            } else {
              await review.getByText("Unanswered",{exact:true}).waitFor();
              await review.getByText(MCQ_ANSWER,{exact:true}).waitFor();
              assert.equal(await review.locator("article").count(),2);
            }
            await review.locator('input[name="score"]').fill("0");
            await review.locator('select[name="decision"]').selectOption("FAIL");
            await review.locator('textarea[name="reason"]').fill(CONTENT_MODE === "WRITTEN_ONLY" ? "The retained written response does not demonstrate the required hazard control reasoning." : "The pinned written question was unanswered and does not demonstrate the required hazard control reasoning.");
            await review.getByRole("button",{name:"Save scoring decision"}).click();
            await verifier.reload();review=verifier.locator("tbody tr").filter({hasText:journeyCaseId}).first();
            await review.getByPlaceholder("Criterion").fill(CONTENT_MODE === "WRITTEN_ONLY" ? "Insufficient hazard control reasoning" : "Unanswered hazard control reasoning");
            await review.locator('input[name="mark"]').fill("0");
            await review.getByRole("button",{name:"Save mark"}).click();
            await verifier.reload();review=verifier.locator("tbody tr").filter({hasText:journeyCaseId}).first();
            await review.getByRole("button",{name:"Finalize review"}).click();
            await verifier.reload();await review.getByText("FINAL",{exact:true}).waitFor();
            console.log("ACTUAL_WRITTEN_REVIEW_BROWSER pinned questions and omitted response reviewed by assigned Verifier; human FAIL finalized");
            return {attemptId};
          }

          if(CONTENT_MODE!=="WRITTEN_ONLY") { await worker.getByText(MCQ_PROMPT,{exact:false}).waitFor();await assertCandidateQuestionBoundary(worker);
          let mcqOffline = process.env.HSE_MASTERPLAN_MCQ_OFFLINE === "true";
          if (mcqOffline) await workerContext.route("**/worker/assessments/**", route => route.request().method() === "POST" && mcqOffline ? route.abort("internetdisconnected") : route.continue());
          await worker.getByLabel(MCQ_ANSWER).check();
          if (mcqOffline) {
            await worker.getByText("Offline buffered — reconnecting", {exact:true}).waitFor({timeout:15000});
            await worker.reload({waitUntil:"domcontentloaded"});
            await worker.getByLabel(MCQ_ANSWER).waitFor();
            await worker.waitForFunction(answer => [...document.querySelectorAll("label")].some(label => label.textContent.trim() === answer && label.querySelector('input[type="radio"]')?.checked), MCQ_ANSWER);
            assert.equal(await worker.getByLabel(MCQ_ANSWER).isChecked(), true, "Offline MCQ selection was lost after reload.");
            mcqOffline = false;
            await worker.getByText("Saved", {exact:true}).waitFor({timeout:15000});
            console.log("JOURNEY: offline MCQ reload and acknowledged reconnect");
          }
          await worker.getByRole("button",{name:CONTENT_MODE==="MCQ_ONLY" ? "Submit assessment" : /^(Next|Save answer)$/}).click();
          if(CONTENT_MODE!=="MCQ_ONLY") {
          if(DELIVERY_MODE==="SECTION_REVIEW") {
            await worker.getByRole("button",{name:"Lock section and continue",exact:true}).waitFor();
            await reviseCommittedAnswer(worker,baseUrl,attemptId,1);
            await worker.getByRole("button",{name:"Lock section and continue",exact:true}).click();
            await assertReviewUnavailable(workerContext,baseUrl,attemptId,1);
          } else if(DELIVERY_MODE==="CONTROLLED_REVIEW") {
            await reviseCommittedAnswer(worker,baseUrl,attemptId,1);
          } else {
            await assertReviewUnavailable(workerContext,baseUrl,attemptId,1);
          }
          } }
          if(CONTENT_MODE!=="MCQ_ONLY") {
          await worker.getByText(WRITTEN_PROMPT,{exact:false}).waitFor();await worker.getByLabel("Your answer").fill("Stop work, verify the isolated hazard is controlled, and only restart after confirming the area is safe.");if(process.env.HSE_MASTERPLAN_OFFLINE_RECOVERY === "true") {
            await worker.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
            const recoveredAnswer = "Offline retained response: stop work, isolate the hazard, verify controls, and restart only after authorization.";
            let concurrent = null;
            if (process.env.HSE_MASTERPLAN_OFFLINE_OPENER === "true") {
              const popup = worker.waitForEvent("popup");
              await worker.evaluate(() => window.open(location.href, "assessment-second-tab"));
              concurrent = await popup;
              await concurrent.waitForLoadState("domcontentloaded");
            } else if (process.env.HSE_MASTERPLAN_OFFLINE_TABS === "true") {
              concurrent = await workerContext.newPage();
            }
            if (concurrent) {
              await concurrent.goto(worker.url());
              await concurrent.getByLabel("Your answer").waitFor();
              await concurrent.getByRole("button", {name:"Submit assessment",exact:true}).waitFor();
            }
            const failSave = route => route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue();
            await workerContext.route("**/*", failSave);
            await worker.getByLabel("Your answer").fill(recoveredAnswer);
            await worker.getByText(/^(Offline buffered|Not saved) — reconnecting$/).waitFor({ timeout: 15000 });
            if (concurrent) {
              await concurrent.route("**/*", route => route.continue());
              await concurrent.getByLabel("Your answer").fill("Concurrent saved answer: verify the isolated hazard and document the safe restart controls.");
              await concurrent.getByText("Saved", {exact:true}).first().waitFor({timeout:15000});
              await concurrent.close();
            }
            const encryption = await worker.evaluate(async () => {
              const db = await new Promise((resolve, reject) => {
                const r = indexedDB.open("hse-assessment-pending");
                r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
              });
              try {
                const rows = await new Promise((resolve, reject) => {
                  const r = db.transaction("pending").objectStore("pending").getAll();
                  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
                });
                return {
                  nonExtractableKey: rows.some(row => row instanceof CryptoKey && row.extractable === false),
                  encryptedDraft: rows.some(row => row.ciphertext instanceof ArrayBuffer && !("value" in row))
                };
              } finally { db.close(); }
            });
            assert.deepEqual(encryption, { nonExtractableKey: true, encryptedDraft: true });
            await worker.addInitScript(() => {
              const original = IDBObjectStore.prototype.get;
              IDBObjectStore.prototype.get = function(key) {
                const operation = original.call(this, key);
                if (typeof key === "string" && key.startsWith("edit:")) {
                  window.__pendingOfflineRead = true;
                  Object.defineProperty(operation, "onsuccess", {
                    set(handler) {
                      operation.addEventListener("success", event => {
                        setTimeout(() => { handler.call(operation, event); window.__pendingOfflineRead = false; }, 1200);
                      }, { once: true });
                    }
                  });
                }
                return operation;
              };
            });
            await worker.reload({ waitUntil: "domcontentloaded" });
            await worker.waitForFunction(() => window.__pendingOfflineRead === true);
            assert.equal(await worker.getByRole("button", { name: "Submit assessment", exact: true }).isDisabled(), true,
              "Final submission was enabled before the offline answer finished restoring.");
            assert.equal(await worker.getByLabel("Your answer").isDisabled(), true,
              "Answer editing remained enabled before the retained offline response finished restoring.");
            await worker.waitForFunction(value => document.querySelector("#assessment-short-answer")?.value === value, recoveredAnswer, { timeout: 10000 });
            assert.equal(await worker.getByLabel("Your answer").inputValue(), recoveredAnswer,
              "A browser reload discarded the unsynchronized offline assessment answer.");
            if (concurrent) {
              await worker.getByRole("button", {name:"Replace saved version with this tab",exact:true}).waitFor();
              assert.equal(await worker.getByRole("button", {name:"Submit assessment",exact:true}).isDisabled(),true,
                "A server revision conflict exposed direct final submission.");
            }
            await workerContext.unroute("**/*", failSave);
            if (concurrent) await worker.getByRole("button", {name:"Replace saved version with this tab",exact:true}).click();
            await worker.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
            console.log("JOURNEY: offline answer survives reload and reconnects");
          }
          if(["resume","replacement"].includes(process.env.HSE_MASTERPLAN_RECOVERY_MODE)) {
            console.log("JOURNEY: emergency exit -> Verifier recovery review -> "+process.env.HSE_MASTERPLAN_RECOVERY_MODE);
            await worker.getByRole("button",{name:"Emergency exit",exact:true}).click();
            await worker.waitForURL(`${baseUrl}/worker/available-assessments`,{timeout:20000});
            await worker.getByText("Interrupted",{exact:true}).waitFor();
            await worker.getByText("I cannot use the bound device",{exact:true}).click();
            await worker.getByLabel("Why is recovery review required?").fill("The bound browser was temporarily unavailable after an emergency interruption; please authorize recovery.");
            await worker.getByRole("button",{name:"Request recovery review",exact:true}).click();
            await worker.getByText(/^Recovery review requested/).waitFor({timeout:20000});
            assert.equal(await worker.getByRole("button",{name:"Resume bound assessment",exact:true}).count(),0,"Review-required attempt exposed an immediate resume command");
            await login(verifier,baseUrl,credentials.verifier,"verifier");
            await verifier.goto(`${baseUrl}/verifier/assessment-recovery`);
            let recovery=verifier.locator("article").filter({hasText:attemptId});
            await recovery.getByRole("button",{name:"Claim recovery review",exact:true}).click();
            await verifier.getByText("Recovery review claimed.",{exact:true}).waitFor();
            recovery=verifier.locator("article").filter({hasText:attemptId});
            await recovery.locator('select[name="decision"]').selectOption(process.env.HSE_MASTERPLAN_RECOVERY_MODE === "replacement" ? "APPROVE_REPLACEMENT" : "ALLOW_RESUME");
            await recovery.getByLabel("Decision reason",{exact:true}).fill("The original bound browser is available again; retained responses and question exposure must be preserved.");
            await recovery.getByRole("button",{name:"Record recovery decision",exact:true}).click();
            await verifier.getByText("Recovery decision recorded.",{exact:true}).waitFor();
            await worker.goto(`${baseUrl}/worker/available-assessments`);
            if(process.env.HSE_MASTERPLAN_RECOVERY_MODE === "replacement") {
              await worker.getByRole("button",{name:"Start assessment",exact:true}).click();
              await worker.waitForURL(/\/precheck\?/,{timeout:15000});
              await worker.getByRole("button",{name:"Run device checks",exact:true}).click();
              await worker.getByText("Device checks completed.",{exact:true}).waitFor();
              await worker.getByLabel("I confirm I am the Worker assigned to this assessment.").check();
              await worker.getByLabel(/I confirm my environment is suitable/).check();
              await worker.getByLabel(/I consent to the monitoring signals/).check();
              await worker.getByRole("button",{name:"Begin assessment",exact:true}).click();
              await worker.waitForURL(/\/worker\/assessments\/assessment_attempt_/,{timeout:20000});
              attemptId=worker.url().split("/").pop();
              assert.notEqual(attemptId,originalAttemptId,"Replacement reused the interrupted attempt");
              await worker.getByLabel(MCQ_ANSWER).check();
              await worker.getByRole("button",{name:"Next",exact:true}).click();
              await worker.getByLabel("Your answer").fill("Stop work, verify the isolated hazard is controlled, and only restart after confirming the area is safe.");
            } else {
              await worker.getByRole("button",{name:"Resume bound assessment",exact:true}).click();
              await worker.waitForURL(`${baseUrl}/worker/assessments/${attemptId}`,{timeout:20000});
            }
          } else {
            await worker.getByRole("button",{name:"Save and exit"}).click();await worker.waitForURL(`${baseUrl}/worker/available-assessments`,{timeout:20000});await worker.getByRole("link",{name:"Resume assessment"}).click();
          }await worker.getByLabel("Your answer").waitFor();assert.match(await worker.getByLabel("Your answer").inputValue(),process.env.HSE_MASTERPLAN_OFFLINE_RECOVERY === "true" ? /^Offline retained response: stop work, isolate the hazard, verify controls/ : /verify the isolated hazard/);await worker.getByRole("button",{name:DELIVERY_MODE==="STRICT" ? "Submit assessment" : "Save final answer for review",exact:true}).click();
          if(DELIVERY_MODE!=="STRICT") {
            await reviseCommittedAnswer(worker,baseUrl,attemptId,2);
            await worker.getByRole("button",{name:"Submit assessment",exact:true}).click();
          }
          }
          await worker.getByText("Assessment submitted",{exact:true}).waitFor({timeout:20000});
          await assertReviewUnavailable(workerContext,baseUrl,attemptId,CONTENT_MODE==="COMBINED" ? 2 : 1);

          if(CONTENT_MODE!=="MCQ_ONLY") {
          if(!["resume","replacement"].includes(process.env.HSE_MASTERPLAN_RECOVERY_MODE)) await login(verifier,baseUrl,credentials.verifier,"verifier");await verifier.goto(`${baseUrl}/verifier/reviews/scoring`);let scoreRow=verifier.locator("tbody tr").filter({hasText:journeyCaseId}).first();await scoreRow.waitFor({timeout:20000});await scoreRow.locator('input[name="score"]').fill("92");await scoreRow.locator('select[name="decision"]').selectOption("PASS");await scoreRow.locator('textarea[name="reason"]').fill("Written response demonstrates correct hazard isolation and verification sequence.");await scoreRow.getByRole("button",{name:"Save scoring decision"}).click();await verifier.reload();scoreRow=verifier.locator("tbody tr").filter({hasText:journeyCaseId}).first();await scoreRow.getByPlaceholder("Criterion").fill("Hazard control reasoning");await scoreRow.locator('input[name="mark"]').fill("92");await scoreRow.getByRole("button",{name:"Save mark"}).click();await verifier.reload();scoreRow=verifier.locator("tbody tr").filter({hasText:journeyCaseId}).first();await scoreRow.getByRole("button",{name:"Finalize review"}).click();

          }
          if(process.env.HSE_MASTERPLAN_TIMING !== "true" && !INTERVIEW_POLICY) await login(admin,baseUrl,credentials.admin,"admin");
          await admin.goto(`${baseUrl}/admin/assessor-matching`,{waitUntil:"domcontentloaded"});
          const unassignedCard=admin.locator("article").filter({hasText:"Masterplan Worker"}).first();
          if(await unassignedCard.count()){
            await unassignedCard.getByRole("button",{name:"Run automatic match"}).click();
            await admin.waitForURL(/\/admin\/assessor-matching\?result=/,{timeout:20000});
            const matchingStatus=await admin.getByRole("status").innerText();
            assert.match(matchingStatus,/assigned to the highest-ranked eligible Assessor/i,matchingStatus);
          }

          await login(assessor,baseUrl,credentials.assessor,"assessor");await assessor.goto(`${baseUrl}/assessor/interviews`);let interviewRow=assessor.locator("tbody tr").filter({hasText:journeyCaseId}).first();try{await interviewRow.waitFor({timeout:20000});}catch(error){throw new Error("Interview handoff missing after finalized review.\nVERIFIER:\n"+await verifier.locator("body").innerText()+"\nADMIN MATCHING:\n"+await admin.locator("body").innerText()+"\nSERVER:\n"+output(),{cause:error});}const href=await interviewRow.getByRole("link",{name:"Open interview console"}).getAttribute("href");assert.ok(href);const interviewId=href.split("/").pop();const schedule=new Date(Date.now()+5*60_000).toISOString().slice(0,16);await interviewRow.getByLabel("Interview time").fill(schedule);await interviewRow.getByRole("button",{name:"Schedule"}).click();await assessor.reload();interviewRow=assessor.locator("tbody tr").filter({hasText:journeyCaseId}).first();await interviewRow.getByText(/ASSIGNED/).waitFor();

          await worker.goto(`${baseUrl}/worker/interviews/${interviewId}`);await worker.getByRole("button",{name:"Enter waiting room"}).click();await worker.getByRole("button",{name:"Check camera, microphone & connection"}).click();await worker.getByText("Camera, microphone and connection checks passed.",{exact:true}).waitFor({timeout:20000});await worker.getByLabel("I confirm I am the Worker assigned to this interview.").check();await worker.getByRole("button",{name:"Ready for Interview"}).click();await worker.getByText(/Ready checks and required consent are recorded/).waitFor({timeout:20000});

          await assessor.goto(`${baseUrl}${href}`);await assessor.getByRole("button",{name:"Claim interview"}).click();await assessor.getByRole("button",{name:"Admit ready Worker"}).waitFor({timeout:20000});await assessor.getByRole("button",{name:"Admit ready Worker"}).click();await assessor.getByRole("button",{name:"Start interview"}).waitFor({timeout:20000});await assessor.getByRole("button",{name:"Start interview"}).click();await configuredInterviewDuration(assessor);await assessor.getByLabel(/I allow this browser to use my camera and microphone/).check();await assessor.getByRole("button",{name:"Enable camera & microphone"}).click();await assessor.getByText("Waiting for worker to join",{exact:true}).waitFor({timeout:20000});
          await assessor.getByRole("tab",{name:"Questions",exact:true}).click();if (INTERVIEW_POLICY) {
            await assessor.getByLabel("Approved follow-up question").selectOption("follow");
            await assessor.getByText("Approved policy version:",{exact:false}).waitFor();
          } else await assessor.getByLabel("Assessor follow-up question").fill("Describe how you would verify the area remains controlled before restart.");await assessor.getByRole("button",{name:"Add versioned follow-up"}).click();await assessor.getByLabel("Pause reason").fill("Controlled pause to verify the candidate connection.");await assessor.getByRole("button",{name:"Pause interview"}).click();await assessor.getByRole("button",{name:"Resume interview"}).waitFor({timeout:15000});await assessor.getByRole("button",{name:"Resume interview"}).click();if(INTERVIEW_POLICY)configuredActiveSince.set(assessor,Date.now());
          await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
          for(const label of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"])await assessor.getByLabel(label).fill("5");
          await assessor.getByLabel("Notes",{exact:true}).fill("Candidate consistently explained controlled isolation and verification.");await assessor.getByLabel("Scorecard comments").fill("Strong evidence-based interview.");await assessor.locator('select[name="recommendation"]').selectOption("PASS");await configuredInterviewCoverage(assessor,{denyIncomplete:true});await assessor.getByRole("button",{name:"Save draft"}).click();await assessor.waitForFunction(()=>document.querySelector('select[name="recommendation"]')?.value==="PASS");await waitConfiguredActiveMinimum(assessor);await assessor.getByRole("button",{name:"End interview"}).waitFor({timeout:15000});await assessor.getByRole("button",{name:"End interview"}).click();await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();await assessor.getByRole("button",{name:"Submit final recommendation"}).waitFor({timeout:15000});const finalForm=assessor.getByRole("button",{name:"Submit final recommendation"}).locator("xpath=ancestor::form");const validity=await finalForm.evaluate((form)=>({valid:form.checkValidity(),invalid:[...form.querySelectorAll(":invalid")].map((el)=>({name:el.getAttribute("name"),value:(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement)?el.value:null}))}));assert.equal(validity.valid,true,"Final interview form invalid: "+JSON.stringify(validity.invalid));await assessor.getByRole("button",{name:"Submit final recommendation"}).click();try{await assessor.getByText(/Final interview record submitted and locked/).waitFor({timeout:20000});}catch(error){throw new Error("Final recommendation transaction failed.\nASSESSOR:\n"+await assessor.locator("body").innerText()+"\nSERVER:\n"+output(),{cause:error});}

          await admin.goto(`${baseUrl}/admin/decisions?tenantId=${journeyTenantId}&caseId=${journeyCaseId}`,{waitUntil:"domcontentloaded"});const decisionForm=admin.locator("form").filter({has:admin.getByRole("button",{name:"Create decision"})});await decisionForm.getByLabel("State").selectOption("APPROVED");await decisionForm.getByLabel("Reason code").fill("all_stages_passed");await decisionForm.getByLabel("Explanation").fill("Identity, qualification, assessment, human scoring and structured interview are all complete.");await decisionForm.getByLabel("Rule version").fill("masterplan-e2e-v1");await decisionForm.getByLabel("Input references").fill(`${attemptId},${interviewId}`);await decisionForm.getByRole("button",{name:"Create decision"}).click();try{await admin.getByRole("heading",{name:"APPROVED",exact:true}).waitFor({timeout:20000});}catch(error){throw new Error("Final decision failed at actual browser boundary.\nADMIN URL: "+admin.url()+"\nADMIN:\n"+await admin.locator("body").innerText()+"\nSERVER:\n"+output(),{cause:error});}

          await worker.goto(`${baseUrl}/worker/passport`);await worker.getByText("End-to-End Worker Assessment",{exact:true}).first().waitFor({timeout:20000});await worker.getByText(COMPLETE_REASSESSMENT?/valid · expires \d{4}-\d{2}-\d{2}/i:/valid · no expiry recorded/i).waitFor();
          await worker.goto(`${baseUrl}/worker/appeals`);const credentialOption=worker.locator('select[name="credentialId"] option').filter({hasText:"End-to-End Worker Assessment"});const credentialId=await credentialOption.getAttribute("value");assert.ok(credentialId?.startsWith("credential_id_"));
          const publicPage=await workerContext.newPage();const publicResponse=await publicPage.goto(`${baseUrl}/verify/result/${credentialId}`,{waitUntil:"domcontentloaded"});assert.equal(publicResponse?.status(),200);await publicPage.getByText("End-to-End Worker Assessment",{exact:true}).waitFor();const publicApi=await publicPage.request.get(`${baseUrl}/api/credentials/${credentialId}`);assert.equal(publicApi.status(),200);assert.equal((await publicApi.json()).status,"valid");
          const pdf=await publicPage.request.get(`${baseUrl}/api/credentials/${credentialId}/pdf`);assert.equal(pdf.status(),200);assert.match(pdf.headers()["content-type"],/application\/pdf/);assert.ok((await pdf.body()).subarray(0,8).toString().startsWith("%PDF-1.4"));await publicPage.close();

          await worker.goto(`${baseUrl}/worker/share-links`);await worker.getByLabel("Competencies", { exact: true }).check();await worker.getByLabel("Purpose").fill("Masterplan end-to-end verification");await worker.getByLabel("Recipient or employer (optional)").fill("E2E Employer");await worker.getByLabel("Link expiry").selectOption("7");await worker.getByRole("button",{name:"Create secure link"}).click();await worker.getByText("Share link created.",{exact:false}).waitFor({timeout:15000});const shareUrl=await worker.getByRole("link",{name:"Open secure share link"}).getAttribute("href");assert.ok(shareUrl);const share=await workerContext.newPage();await share.goto(`${baseUrl}${shareUrl}`);await share.getByText("End-to-End Worker Assessment",{exact:true}).waitFor({timeout:15000});await share.close();

          await worker.goto(`${baseUrl}/worker/appeals`);await worker.getByLabel("Credential").selectOption(credentialId);await worker.getByLabel("Appeal grounds").fill("The issued competency should be reassessed against the retained qualification evidence after this end-to-end verification.");await worker.locator('input[name="evidenceRecordIds"]').first().check();await worker.getByRole("button",{name:"Submit credential appeal"}).click();await worker.getByText("Appeal submitted for independent review.",{exact:true}).waitFor({timeout:15000});
          // The issuing Admin is denied; the separate real Admin logs in to review.
          const denyResponse=await admin.request.post(baseUrl+"/api/credentials/appeals/"+(await worker.locator("article").filter({hasText:credentialId}).first().locator('input[name="appealId"]').getAttribute("value")),{data:{status:"accepted",reason:"Original decision actor cannot decide their own appeal.",outcomeAction:"reassessment"}});
          assert.equal(denyResponse.status(),403);
          assert.deepEqual(await denyResponse.json(),{error:"appeal_review_forbidden"});
          await worker.reload();
          await worker.locator("article").filter({hasText:credentialId}).first().getByText(/^Status: submitted · Version 1/).waitFor();
          const appealContext=await browser.newContext({viewport:{width:1440,height:1000}});
          const appealReviewer=await appealContext.newPage();
          await login(appealReviewer,baseUrl,credentials.appealAdmin,"admin");
          await appealReviewer.goto(`${baseUrl}/admin/appeals`);let appeal=appealReviewer.locator("article").filter({hasText:credentialId}).first();await appeal.getByLabel("Review status").selectOption("under_review");await appeal.getByLabel("Accepted-outcome action").selectOption("none");await appeal.getByLabel("Reasoned review outcome").fill("Independent review opened against the original issued credential and retained qualification evidence.");await appeal.getByRole("button",{name:"Record appeal review"}).click();await appeal.getByText(/^Status: under review · Version/).waitFor({timeout:15000});await appealReviewer.reload();appeal=appealReviewer.locator("article").filter({hasText:credentialId}).first();await appeal.getByLabel("Review status").selectOption("accepted");await appeal.getByLabel("Accepted-outcome action").selectOption("reassessment");await appeal.getByLabel("Reasoned review outcome").fill("Appeal accepted; competency reassessment is required before returning the Living Record to valid.");await appeal.getByRole("button",{name:"Record appeal review"}).click();await appeal.getByText(/^Status: accepted · Version/).waitFor({timeout:15000});
          await appealContext.close();
          await worker.goto(`${baseUrl}/worker/passport`);await worker.getByText(COMPLETE_REASSESSMENT?/reassessment required · expires \d{4}-\d{2}-\d{2}/i:/reassessment required · no expiry recorded/i).waitFor({timeout:20000});await worker.getByText(/Version 2 · reassessment required/i).waitFor();

          assert.deepEqual(errors.filter(e=>!e.includes("favicon") && !((process.env.HSE_MASTERPLAN_OFFLINE_RECOVERY === "true" || process.env.HSE_MASTERPLAN_MCQ_OFFLINE === "true") && e === "Failed to load resource: net::ERR_INTERNET_DISCONNECTED")),[],`Browser errors:\n${errors.join("\n")}\n${output()}`);
          return {credentialId,interviewId,attemptId,originalAttemptId};
        } finally {await companyContext.close();await workerContext.close();await verifierContext.close();await assessorContext.close();await adminContext.close();await browser.close();}
      }
    });
    assert.equal(phase2.requestedSignal,"SMOKE_COMPLETE");

    if(EXPIRY_MODE) {
      const verify=new PGlite(dbDir);
      try {
        const attempt=(await verify.query("SELECT attempt_id,status FROM assessment_attempts WHERE case_id=$1",[journeyCaseId])).rows[0];
        assert.equal(attempt.status,"AUTO_SUBMITTED");
        const answers=(await verify.query("SELECT position,text_value FROM assessment_attempt_answers WHERE attempt_id=$1",[attempt.attempt_id])).rows;
        assert.deepEqual(answers,[{position:1,text_value:CONTENT_MODE==="WRITTEN_ONLY" ? "Draft response retained at written-only natural expiry." : MCQ_ANSWER}]);
        const audit=(await verify.query("SELECT actor_account_id,actor_role,metadata FROM platform_audit_events WHERE action_key='assessment.attempt.submitted' AND target_reference=$1",[attempt.attempt_id])).rows;
        assert.equal(audit.length,1);assert.equal(audit[0].actor_account_id,null);assert.equal(audit[0].metadata.systemComponent,"outbox-worker");
        console.log("ACTUAL_EXPIRY_DB one retained draft, no fabricated written answer, one truthful system submission");
        if(CONTENT_MODE!=="MCQ_ONLY") {
        const reviews=(await verify.query("SELECT score,decision,status FROM written_score_reviews WHERE attempt_id=$1",[attempt.attempt_id])).rows;
        assert.deepEqual(reviews,[{score:0,decision:"FAIL",status:"FINAL"}]);
        assert.equal((await verify.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[journeyCaseId])).rows[0].case_status,"Reassessment required");
        console.log("ACTUAL_WRITTEN_REVIEW_DB final human decision and retained reassessment outcome");
        }
      } finally {await verify.close();}
      return;
    }
    console.log("JOURNEY: credential, sharing and appeal completed");
    const reassessmentDb=new PGlite(dbDir);
    try {
      for(const [seed,type] of [["reassess-mcq","MULTIPLE_CHOICE"],["reassess-written","SHORT_TEXT"]]) {
        const qid=stableId("assessment_question",seed),vid=stableId("question_version",seed),prompt=`Fresh reassessment ${type} question: identify and control the hazard.`,fp=createHash("sha256").update(prompt).digest("hex");
        const source=(await reassessmentDb.query("SELECT * FROM assessment_question_versions WHERE question_type=$1 LIMIT 1",[type])).rows[0];
        await seedPublishedQuestion(reassessmentDb,{questionId:qid,versionId:vid,reference:seed,questionType:type,prompt,options:source.options_json,answerKey:source.answer_key_json,rubric:source.rubric_json,frameworkId:source.framework_id,domainReference:source.domain_reference,difficulty:source.difficulty,tags:source.tags_json,fingerprint:fp,authorAccountId:credentials.admin.accountId,now:new Date().toISOString()});
      }
    } finally {await reassessmentDb.close();}
    let originalCredentialId,originalAppealId,originalAppealVersion,originalCredentialBefore,originalPolicyBefore,originalAppealEventsBefore,reassessmentCaseId=null,reassessmentApplicationId=null;
    if(process.env.HSE_MASTERPLAN_COMPLETE_REASSESSMENT === "true") {
    assert.equal(CONTENT_MODE,"COMBINED");
    assert.equal(DELIVERY_MODE,"STRICT");
    const oldDb=new PGlite(dbDir);

    try {
      originalCredentialId=(await oldDb.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[journeyCaseId])).rows[0].credential_reference;
      const accepted=(await oldDb.query("SELECT appeal_id,version FROM credential_appeals WHERE credential_id=$1 AND status='accepted' AND outcome_action='reassessment'",[originalCredentialId])).rows;
      assert.equal(accepted.length,1);originalAppealId=accepted[0].appeal_id;originalAppealVersion=Number(accepted[0].version);
      const reviewer=(await oldDb.query("SELECT reviewer_account_id FROM credential_appeals WHERE appeal_id=$1",[originalAppealId])).rows[0].reviewer_account_id;
      assert.equal(reviewer,credentials.appealAdmin.accountId);
      const originalActors=(await oldDb.query("SELECT actor_account_id FROM assurance_case_timeline_events WHERE case_id=$1 AND event_type='decision_recorded'",[journeyCaseId])).rows;
      assert.deepEqual(originalActors.map(event=>event.actor_account_id),[credentials.admin.accountId]);
      assert.notEqual(reviewer,originalActors[0].actor_account_id);
      originalCredentialBefore=(await oldDb.query("SELECT issued_at,expires_at,qr_payload,signature FROM credential_issuances WHERE credential_id=$1",[originalCredentialId])).rows[0];
      originalPolicyBefore=(await oldDb.query("SELECT * FROM assurance_case_policy_snapshots WHERE case_id=$1",[journeyCaseId])).rows;
      originalAppealEventsBefore=(await oldDb.query("SELECT * FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[originalAppealId])).rows;
      assert.equal(new Date(originalCredentialBefore.expires_at).getTime()-new Date(originalCredentialBefore.issued_at).getTime(),60*86400000);
    }
    finally { await oldDb.close(); }

    const reassessment=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:`${baseUrl}/worker/login`,projectRoot:root,environment:env,
      probe:async({output})=>{
        const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
        const workerContext=await browser.newContext({viewport:{width:1440,height:1000},permissions:["camera","microphone"]});
        const verifierContext=await browser.newContext({viewport:{width:1440,height:1000}});
        const assessorContext=await browser.newContext({viewport:{width:1440,height:1000},permissions:["camera","microphone"]});
        const adminContext=await browser.newContext({viewport:{width:1440,height:1000}});
        const worker=await workerContext.newPage(),verifier=await verifierContext.newPage(),assessor=await assessorContext.newPage(),admin=await adminContext.newPage();
        const errors=[];for(const p of [worker,verifier,assessor,admin]){p.on("pageerror",e=>errors.push(e.message));p.on("console",m=>{if(m.type()==="error")errors.push(m.text());});}
        try{
          await login(worker,baseUrl,{email:EMAIL,password:PASSWORD},"worker");
          await worker.goto(baseUrl+"/worker/appeals");
          const acceptedAppeal=worker.locator('article[id="'+originalAppealId+'"]');
          await acceptedAppeal.getByText(/^Status: accepted · Version/).waitFor();
          await acceptedAppeal.getByRole("link",{name:"Continue reassessment",exact:true}).click();
          await worker.waitForURL(url=>url.pathname==="/worker/assessment-applications" && url.searchParams.get("sourceAppealId")===originalAppealId,{timeout:20000});
          const applicationForm=worker.getByRole("button",{name:"Apply — worker pays"}).locator("xpath=ancestor::form");
          assert.equal(await applicationForm.locator('input[name="sourceAppealId"]').inputValue(),originalAppealId);
          await worker.getByRole("button",{name:"Apply — worker pays"}).click();
          await worker.getByText("Application created. Complete the sandbox self-payment confirmation to fund the assessment.",{exact:true}).waitFor({timeout:20000});
          await worker.getByText("Status: COMPLETED",{exact:true}).waitFor();
          const paymentForm=worker.getByRole("button",{name:"Confirm sandbox payment"}).locator("xpath=ancestor::form");
          reassessmentApplicationId=await paymentForm.locator('input[name="applicationId"]').inputValue();
          await worker.getByRole("button",{name:"Confirm sandbox payment"}).click();
          await worker.getByText("Funding confirmed. The assessment case is ready.",{exact:true}).waitFor({timeout:20000});
          reassessmentCaseId=(await worker.locator("article").filter({hasText:"Status: CASE CREATED"}).getByText(/^assurance_case_[A-Za-z0-9_-]{24}$/).innerText()).trim();
          assert.match(reassessmentCaseId,/^assurance_case_[A-Za-z0-9_-]{24}$/);
          const reassessmentApplication=worker.locator("article").filter({hasText:reassessmentCaseId});
          await reassessmentApplication.getByText(originalAppealId,{exact:true}).waitFor();
          await reassessmentApplication.getByRole("link",{name:"Continue to available assessments"}).click();
          await worker.waitForURL("**/worker/available-assessments",{timeout:20000});
          const eligibleHeading=worker.getByRole("region",{name:"Eligible assessment offerings"}).getByRole("heading",{name:"End-to-End Worker Assessment"});
          try {
            await eligibleHeading.waitFor({timeout:20000});
          } catch (error) {
            throw new Error("Available-assessments page did not expose the funded case. URL="+worker.url()+"\nBODY:\n"+await worker.locator("body").innerText(),{cause:error});
          }
          await worker.getByRole("button",{name:"Start assessment"}).click();await worker.waitForURL(/\/precheck\?/,{timeout:15000});
          await worker.getByRole("button",{name:"Run device checks"}).click();await worker.getByText("Device checks completed.",{exact:true}).waitFor({timeout:15000});await worker.getByLabel("I confirm I am the Worker assigned to this assessment.").check();await worker.getByLabel(/I confirm my environment is suitable/).check();await worker.getByLabel(/I consent to the monitoring signals/).check();await worker.getByRole("button",{name:"Begin assessment"}).click();await worker.waitForURL(/\/worker\/assessments\/assessment_attempt_/,{timeout:20000});
          const attemptId=worker.url().split("/").pop();
          await worker.getByText("Fresh reassessment MULTIPLE_CHOICE question: identify and control the hazard.",{exact:false}).waitFor();
          await assertCandidateQuestionBoundary(worker);
          await worker.getByLabel(MCQ_ANSWER).check();
          await worker.getByRole("button",{name:"Next",exact:true}).click();
          await worker.getByText("Fresh reassessment SHORT_TEXT question: identify and control the hazard.",{exact:false}).waitFor();
          await worker.getByLabel("Your answer").fill("Stop work, isolate the hazard, verify controls, and restart only after authorization.");
          await worker.getByRole("button",{name:"Submit assessment",exact:true}).click();
          await worker.getByText("Assessment submitted",{exact:true}).waitFor({timeout:20000});
          if(CONTENT_MODE!=="MCQ_ONLY") {
          await login(verifier,baseUrl,credentials.verifier,"verifier");await verifier.goto(`${baseUrl}/verifier/reviews/scoring`);let scoreRow=verifier.locator("tbody tr").filter({hasText:reassessmentCaseId}).first();await scoreRow.waitFor({timeout:20000});await scoreRow.locator('input[name="score"]').fill("92");await scoreRow.locator('select[name="decision"]').selectOption("PASS");await scoreRow.locator('textarea[name="reason"]').fill("Written response demonstrates correct hazard isolation and verification sequence.");await scoreRow.getByRole("button",{name:"Save scoring decision"}).click();await verifier.reload();scoreRow=verifier.locator("tbody tr").filter({hasText:reassessmentCaseId}).first();await scoreRow.getByPlaceholder("Criterion").fill("Hazard control reasoning");await scoreRow.locator('input[name="mark"]').fill("92");await scoreRow.getByRole("button",{name:"Save mark"}).click();await verifier.reload();scoreRow=verifier.locator("tbody tr").filter({hasText:reassessmentCaseId}).first();await scoreRow.getByRole("button",{name:"Finalize review"}).click();

          }
          await login(admin,baseUrl,credentials.admin,"admin");
          await admin.goto(`${baseUrl}/admin/assessor-matching`,{waitUntil:"domcontentloaded"});
          const unassignedCard=admin.locator("article").filter({hasText:"Masterplan Worker"}).first();
          if(await unassignedCard.count()){
            await unassignedCard.getByRole("button",{name:"Run automatic match"}).click();
            await admin.waitForURL(/\/admin\/assessor-matching\?result=/,{timeout:20000});
            const matchingStatus=await admin.getByRole("status").innerText();
            assert.match(matchingStatus,/assigned to the highest-ranked eligible Assessor/i,matchingStatus);
          }

          await login(assessor,baseUrl,credentials.assessor,"assessor");await assessor.goto(`${baseUrl}/assessor/interviews`);let interviewRow=assessor.locator("tbody tr").filter({hasText:reassessmentCaseId}).first();try{await interviewRow.waitFor({timeout:20000});}catch(error){throw new Error("Interview handoff missing after finalized review.\nVERIFIER:\n"+await verifier.locator("body").innerText()+"\nADMIN MATCHING:\n"+await admin.locator("body").innerText()+"\nSERVER:\n"+output(),{cause:error});}const href=await interviewRow.getByRole("link",{name:"Open interview console"}).getAttribute("href");assert.ok(href);const interviewId=href.split("/").pop();const schedule=new Date(Date.now()+5*60_000).toISOString().slice(0,16);await interviewRow.getByLabel("Interview time").fill(schedule);await interviewRow.getByRole("button",{name:"Schedule"}).click();await assessor.reload();interviewRow=assessor.locator("tbody tr").filter({hasText:reassessmentCaseId}).first();await interviewRow.getByText(/ASSIGNED/).waitFor();

          await worker.goto(`${baseUrl}/worker/interviews/${interviewId}`);await worker.getByRole("button",{name:"Enter waiting room"}).click();await worker.getByRole("button",{name:"Check camera, microphone & connection"}).click();await worker.getByText("Camera, microphone and connection checks passed.",{exact:true}).waitFor({timeout:20000});await worker.getByLabel("I confirm I am the Worker assigned to this interview.").check();await worker.getByRole("button",{name:"Ready for Interview"}).click();await worker.getByText(/Ready checks and required consent are recorded/).waitFor({timeout:20000});

          await assessor.goto(`${baseUrl}${href}`);await assessor.getByRole("button",{name:"Claim interview"}).click();await assessor.getByRole("button",{name:"Admit ready Worker"}).waitFor({timeout:20000});await assessor.getByRole("button",{name:"Admit ready Worker"}).click();await assessor.getByRole("button",{name:"Start interview"}).waitFor({timeout:20000});await assessor.getByRole("button",{name:"Start interview"}).click();await configuredInterviewDuration(assessor);await assessor.getByLabel(/I allow this browser to use my camera and microphone/).check();await assessor.getByRole("button",{name:"Enable camera & microphone"}).click();await assessor.getByText("Waiting for worker to join",{exact:true}).waitFor({timeout:20000});
          await assessor.getByRole("tab",{name:"Questions",exact:true}).click();if (INTERVIEW_POLICY) {
            await assessor.getByLabel("Approved follow-up question").selectOption("follow");
            await assessor.getByText("Approved policy version:",{exact:false}).waitFor();
          } else await assessor.getByLabel("Assessor follow-up question").fill("Describe how you would verify the area remains controlled before restart.");await assessor.getByRole("button",{name:"Add versioned follow-up"}).click();await assessor.getByLabel("Pause reason").fill("Controlled pause to verify the candidate connection.");await assessor.getByRole("button",{name:"Pause interview"}).click();await assessor.getByRole("button",{name:"Resume interview"}).waitFor({timeout:15000});await assessor.getByRole("button",{name:"Resume interview"}).click();if(INTERVIEW_POLICY)configuredActiveSince.set(assessor,Date.now());
          await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();
          for(const label of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"])await assessor.getByLabel(label).fill("5");
          await assessor.getByLabel("Notes",{exact:true}).fill("Candidate consistently explained controlled isolation and verification.");await assessor.getByLabel("Scorecard comments").fill("Strong evidence-based interview.");await assessor.locator('select[name="recommendation"]').selectOption("PASS");await configuredInterviewCoverage(assessor);await assessor.getByRole("button",{name:"Save draft"}).click();await assessor.waitForFunction(()=>document.querySelector('select[name="recommendation"]')?.value==="PASS");await waitConfiguredActiveMinimum(assessor);await assessor.getByRole("button",{name:"End interview"}).waitFor({timeout:15000});await assessor.getByRole("button",{name:"End interview"}).click();await assessor.getByRole("tab",{name:"Notes and scoring",exact:true}).click();await assessor.getByRole("button",{name:"Submit final recommendation"}).waitFor({timeout:15000});const finalForm=assessor.getByRole("button",{name:"Submit final recommendation"}).locator("xpath=ancestor::form");const validity=await finalForm.evaluate((form)=>({valid:form.checkValidity(),invalid:[...form.querySelectorAll(":invalid")].map((el)=>({name:el.getAttribute("name"),value:(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement)?el.value:null}))}));assert.equal(validity.valid,true,"Final interview form invalid: "+JSON.stringify(validity.invalid));await assessor.getByRole("button",{name:"Submit final recommendation"}).click();try{await assessor.getByText(/Final interview record submitted and locked/).waitFor({timeout:20000});}catch(error){throw new Error("Final recommendation transaction failed.\nASSESSOR:\n"+await assessor.locator("body").innerText()+"\nSERVER:\n"+output(),{cause:error});}

          await admin.goto(`${baseUrl}/admin/decisions?tenantId=${journeyTenantId}&caseId=${reassessmentCaseId}`,{waitUntil:"domcontentloaded"});const decisionForm=admin.locator("form").filter({has:admin.getByRole("button",{name:"Create decision"})});await decisionForm.getByLabel("State").selectOption("APPROVED");await decisionForm.getByLabel("Reason code").fill("all_stages_passed");await decisionForm.getByLabel("Explanation").fill("Identity, qualification, assessment, human scoring and structured interview are all complete.");await decisionForm.getByLabel("Rule version").fill("masterplan-e2e-v1");await decisionForm.getByLabel("Input references").fill(`${attemptId},${interviewId}`);await decisionForm.getByRole("button",{name:"Create decision"}).click();try{await admin.getByRole("heading",{name:"APPROVED",exact:true}).waitFor({timeout:20000});}catch(error){throw new Error("Final decision failed at actual browser boundary.\nADMIN URL: "+admin.url()+"\nADMIN:\n"+await admin.locator("body").innerText()+"\nSERVER:\n"+output(),{cause:error});}

          await worker.goto(baseUrl+"/worker/appeals");
          const credentialOption=worker.locator('select[name="credentialId"] option').filter({hasText:"End-to-End Worker Assessment"});
          const credentialId=(await credentialOption.evaluateAll(options=>options.map(option=>option.value))).find(id=>id!==originalCredentialId);
          assert.ok(credentialId?.startsWith("credential_id_"));
          await worker.goto(baseUrl+"/worker/passport");
          const oldCompetency=worker.locator('[id="'+originalCredentialId+'"]'),newCompetency=worker.locator('[id="'+credentialId+'"]');
          await oldCompetency.getByText(/^revoked · expires /).waitFor();
          await oldCompetency.getByText(REPLACED_RESTRICTION,{exact:true}).waitFor();
          await newCompetency.getByText(/^valid · expires /).waitFor();
          assert.equal(await newCompetency.getByRole("link",{name:"Verify credential",exact:true}).getAttribute("href"),"/verify/result/"+credentialId);
          const livingHistory=worker.locator("section").filter({has:worker.getByRole("heading",{name:"Living Record history",exact:true})});
          await livingHistory.getByText(/^Version 3 · revoked/).waitFor();
          await livingHistory.getByText(/^Version 2 · reassessment required/).waitFor();
          assert.equal(await livingHistory.getByText(/^Version 1 · valid/).count(),2);
          const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();
          try {
            await assertReplacementPublicConsumers(publicPage,baseUrl,originalCredentialId,{status:"revoked",issuedAt:new Date(originalCredentialBefore.issued_at).toISOString(),expiresAt:new Date(originalCredentialBefore.expires_at).toISOString()});
            const freshApi=await publicPage.request.get(baseUrl+"/api/credentials/"+credentialId);
            assert.equal(freshApi.status(),200);const fresh=await freshApi.json();
            await assertReplacementPublicConsumers(publicPage,baseUrl,credentialId,{status:"valid",issuedAt:fresh.issuedAt,expiresAt:fresh.expiresAt});
          }finally{await publicContext.close();}
          console.log("ACTUAL_REASSESSMENT_PUBLIC_BROWSER old revoked, new valid, exact expiry, real PDFs, fresh reloads and Passport retained history");


          assert.deepEqual(errors,[],`Reassessment browser errors:\n${errors.join("\n")}\n${output()}`);
          console.log("JOURNEY: completed reassessment and second credential", reassessmentCaseId, credentialId);
        } finally {await workerContext.close();await verifierContext.close();await assessorContext.close();await adminContext.close();await browser.close();}
      }
    });assert.equal(reassessment.requestedSignal,"SMOKE_COMPLETE");

    } else {
    const reassessment=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:`${baseUrl}/worker/login`,projectRoot:root,environment:env,
      probe:async()=>{const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await login(page,baseUrl,{email:EMAIL,password:PASSWORD},"worker");await page.goto(`${baseUrl}/worker/assessment-applications`);
        await page.getByRole("button",{name:"Apply — worker pays"}).click();await page.getByText("Application created. Complete the sandbox self-payment confirmation to fund the assessment.",{exact:true}).waitFor({timeout:20000});
        await page.getByText("Status: COMPLETED",{exact:true}).waitFor();await page.getByText("Status: PAYMENT REQUIRED",{exact:true}).waitFor();
      } finally {await browser.close();}}});assert.equal(reassessment.requestedSignal,"SMOKE_COMPLETE");

    }

    const verify=new PGlite(dbDir);try{
      if(process.env.HSE_MASTERPLAN_COMPLETE_REASSESSMENT === "true") {
        assert.ok(reassessmentCaseId,"Reassessment never reached its own case.");
        const replacementCase=(await verify.query("SELECT case_status,credential_reference FROM assurance_cases WHERE case_id=$1",[reassessmentCaseId])).rows[0];
        assert.equal(replacementCase.case_status,"Approved");
        assert.ok(replacementCase.credential_reference);
        assert.notEqual(replacementCase.credential_reference,originalCredentialId);
        const replacementLiving=(await verify.query("SELECT v.status FROM living_record_competencies c JOIN living_record_versions v ON v.competency_id=c.competency_id WHERE c.source_credential_id=$1 ORDER BY v.version",[replacementCase.credential_reference])).rows;
        assert.deepEqual(replacementLiving.map(row=>row.status),["valid"]);
        const links=(await verify.query("SELECT * FROM credential_replacements WHERE old_credential_id=$1",[originalCredentialId])).rows;
        assert.equal(links.length,1);const link=links[0];
        assert.equal(link.disposition,"REPLACED");assert.equal(link.appeal_id,originalAppealId);
        assert.equal(link.old_case_id,journeyCaseId);assert.equal(link.new_case_id,reassessmentCaseId);
        assert.equal(link.new_credential_id,replacementCase.credential_reference);assert.equal(link.tenant_id,journeyTenantId);assert.equal(link.worker_id,permanentWorkerId);
        const sources=(await verify.query("SELECT source.*,application.assurance_case_id,application.application_status FROM worker_assessment_reassessment_sources source JOIN worker_assessment_applications application USING(application_id) WHERE source.application_id=$1",[reassessmentApplicationId])).rows;
        assert.equal(sources.length,1);const source=sources[0];
        assert.equal(source.source_appeal_id,originalAppealId);assert.equal(Number(source.source_appeal_version),originalAppealVersion);
        assert.equal(source.source_case_id,journeyCaseId);assert.equal(source.source_tenant_id,journeyTenantId);
        assert.equal(source.source_credential_id,originalCredentialId);assert.equal(source.worker_account_id,workerAccountId);
        assert.equal(source.permanent_worker_id,permanentWorkerId);assert.equal(source.assurance_case_id,reassessmentCaseId);assert.equal(source.application_status,"CASE_CREATED");
        const freshIssuance=(await verify.query("SELECT issued_at,expires_at,qr_payload FROM credential_issuances WHERE credential_id=$1",[replacementCase.credential_reference])).rows[0];
        const validity=JSON.parse(freshIssuance.qr_payload).validity;
        const newPin=(await verify.query("SELECT snapshot_id,global_policy_version_id,framework_id FROM assurance_case_policy_snapshots WHERE case_id=$1",[reassessmentCaseId])).rows[0];
        assert.equal(validity.mode,"days");assert.equal(validity.days,60);
        assert.equal(validity.snapshotId,newPin.snapshot_id);assert.equal(validity.snapshotId,link.policy_snapshot_id);
        assert.equal(validity.policyVersionId,newPin.global_policy_version_id);assert.equal(newPin.framework_id,source.source_framework_id);
        assert.notEqual(newPin.snapshot_id,originalPolicyBefore[0].snapshot_id);
        assert.equal(newPin.global_policy_version_id,originalPolicyBefore[0].global_policy_version_id,"The fresh case must independently pin the actually published current60-day policy.");
        assert.equal(new Date(freshIssuance.expires_at).getTime()-new Date(freshIssuance.issued_at).getTime(),60*86400000);
        assert.deepEqual((await verify.query("SELECT issued_at,expires_at,qr_payload,signature FROM credential_issuances WHERE credential_id=$1",[originalCredentialId])).rows[0],originalCredentialBefore);
        assert.deepEqual((await verify.query("SELECT * FROM assurance_case_policy_snapshots WHERE case_id=$1",[journeyCaseId])).rows,originalPolicyBefore);
        assert.deepEqual((await verify.query("SELECT * FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[originalAppealId])).rows,originalAppealEventsBefore);
        console.log("ACTUAL_REASSESSMENT_LINKAGE_DB explicit immutable application source finalized once, old signature/policy/appeal history retained, new current policy pin");
        const forms=(await verify.query("SELECT attempts.case_id,items.question_id FROM assessment_attempts attempts JOIN generated_assessment_form_items items ON items.form_id=attempts.form_id WHERE attempts.case_id=ANY($1::text[])",[[journeyCaseId,reassessmentCaseId]])).rows;
        const priorQuestions=new Set(forms.filter(row=>row.case_id===journeyCaseId).map(row=>row.question_id));
        const freshQuestions=forms.filter(row=>row.case_id===reassessmentCaseId);
        assert.equal(freshQuestions.length,2);
        assert.ok(freshQuestions.every(row=>!priorQuestions.has(row.question_id)),"Reassessment repeated an exposed question.");
        const replacementOrder=(await verify.query("SELECT order_status FROM assurance_orders WHERE order_id=(SELECT order_id FROM assurance_cases WHERE case_id=$1)",[reassessmentCaseId])).rows[0];
        assert.equal(replacementOrder.order_status,"COMPLETED");
      }
      if(process.env.HSE_MASTERPLAN_TIMING === "true") {
        const clocks=(await verify.query("SELECT policy.time_multiplier,policy.phase_durations_json,clocks.started_at,clocks.deadline_at FROM assessment_attempts attempts JOIN assessment_attempt_time_policies policy USING(attempt_id) JOIN assessment_attempt_clocks clocks USING(attempt_id) WHERE attempts.case_id=$1",[journeyCaseId])).rows;
        assert.equal(clocks.length,1);assert.equal(Number(clocks[0].time_multiplier),1.5);assert.deepEqual(clocks[0].phase_durations_json,[1800]);
        assert.equal(new Date(clocks[0].deadline_at).getTime()-new Date(clocks[0].started_at).getTime(),1800000);
        console.log("ACTUAL_WORKER_TIMING_DB owned approved multiplier snapshotted once, exact1800s clock retained through normal scoring/interview/credential");
      }
      if (INTERVIEW_POLICY) {
        const cases=[journeyCaseId,...(reassessmentCaseId?[reassessmentCaseId]:[])];
        const records=(await verify.query(`SELECT requests.trade_scope,requests.qualification_scope,requests.risk_level,requests.jurisdiction,
          requests.recording_retention_days,snapshots.global_policy_version_id,sets.question_set_id,sets.version_no,
          sets.source_context_json,sets.questions_json,drafts.scorecard,drafts.submitted
          FROM interview_requests requests
          JOIN assurance_case_policy_snapshots snapshots ON snapshots.case_id=requests.case_id AND snapshots.tenant_id=requests.tenant_id
          JOIN LATERAL (SELECT * FROM interview_question_sets WHERE interview_request_id=requests.interview_request_id ORDER BY version_no DESC LIMIT 1) sets ON TRUE
          JOIN interview_console_drafts drafts ON drafts.interview_request_id=requests.interview_request_id
          WHERE requests.case_id=ANY($1::text[]) AND requests.status='COMPLETED'`,[cases])).rows;
        assert.equal(records.length,cases.length);
        for (const row of records) {
          assert.equal(row.trade_scope,"electrical");assert.equal(row.qualification_scope,"level-3");
          assert.equal(row.risk_level,"HIGH");assert.equal(row.jurisdiction,"GB");assert.equal(row.recording_retention_days,45);
          assert.equal(row.source_context_json.policyVersionId,row.global_policy_version_id);
          assert.equal(row.source_context_json.policyMode,"CONFIGURED");
          assert.equal(row.questions_json.filter(q=>q.kind==="RANDOM").length,1);
          assert(row.questions_json.some(q=>q.templateId==="safety"));assert(row.questions_json.some(q=>q.templateId==="follow"));
          assert(!row.questions_json.some(q=>q.templateId==="foreign"));
          assert.equal(row.scorecard.questionSetId,row.question_set_id);assert.equal(row.scorecard.questionSetVersion,row.version_no);
          assert.equal(row.scorecard.coveredQuestionIds.length,row.questions_json.length);
          assert.ok(row.scorecard.activeSeconds>=INTERVIEW_POLICY_MIN_ACTIVE_SECONDS);assert.equal(row.scorecard.safetyFindings[0].status,"NOT_OBSERVED");assert.equal(row.submitted,true);
        }
        console.log("ACTUAL_INTERVIEW_POLICY_DB published version pinned to both cases; authoritative context, approved selection, coverage, findings and exact set reference retained");
      }
      assert.ok(journeyCaseId,"Preserved Worker journey did not expose its Assurance Case ID.");
      const c=(await verify.query("SELECT case_status,decision_reference,credential_reference FROM assurance_cases WHERE case_id=$1",[journeyCaseId])).rows[0];assert.equal(c.case_status,"Approved");assert.ok(c.decision_reference);assert.ok(c.credential_reference);
      if(process.env.HSE_MASTERPLAN_RECOVERY_MODE === "replacement") {
        const attempts=(await verify.query("SELECT attempt_id,form_id,status FROM assessment_attempts WHERE case_id=$1 ORDER BY started_at",[journeyCaseId])).rows;
        assert.deepEqual(attempts.map(r=>r.status),["REPLACED","SUBMITTED"]);
        const items=(await verify.query("SELECT form_id,question_id FROM generated_assessment_form_items WHERE form_id=ANY($1::text[])",[attempts.map(r=>r.form_id)])).rows;
        const oldQuestions=new Set(items.filter(r=>r.form_id===attempts[0].form_id).map(r=>r.question_id));
        assert.equal(oldQuestions.size,2,"Original displayed form was not preserved");
        const newQuestions=items.filter(r=>r.form_id===attempts[1].form_id).map(r=>r.question_id);
        assert.equal(newQuestions.length,2);
        assert.ok(newQuestions.every(id=>!oldQuestions.has(id)),"Replacement repeated an exposed question");
        const answers=(await verify.query("SELECT attempt_id,COUNT(*)::int AS count FROM assessment_attempt_answers WHERE attempt_id=ANY($1::text[]) GROUP BY attempt_id",[attempts.map(r=>r.attempt_id)])).rows;
        assert.equal(answers.find(r=>r.attempt_id===attempts[0].attempt_id)?.count,1,"Original committed answer was lost");
        assert.equal(answers.find(r=>r.attempt_id===attempts[1].attempt_id)?.count,2);
        const preservedDraft=(await verify.query("SELECT position,text_value FROM assessment_attempt_drafts WHERE attempt_id=$1",[attempts[0].attempt_id])).rows[0];
        assert.equal(preservedDraft?.position,2,"Interrupted written draft was lost");
        assert.match(preservedDraft.text_value,/Stop work, verify the isolated hazard/);
        const authorization=(await verify.query("SELECT status,replacement_form_id FROM assessment_replacement_authorizations WHERE original_attempt_id=$1",[attempts[0].attempt_id])).rows[0];
        assert.equal(authorization.status,"CONSUMED");assert.equal(authorization.replacement_form_id,attempts[1].form_id);
      }
      if (process.env.HSE_MASTERPLAN_OFFLINE_RECOVERY === "true" && process.env.HSE_MASTERPLAN_RECOVERY_MODE !== "replacement") {
        const retained = await verify.query(
          "SELECT answers.text_value FROM assessment_attempt_answers answers JOIN assessment_attempts attempts ON attempts.attempt_id=answers.attempt_id WHERE attempts.case_id=$1 AND answers.question_type='SHORT_TEXT' AND attempts.status='SUBMITTED'",
          [journeyCaseId]
        );
        assert.equal(retained.rows[0]?.text_value, "Offline retained response: stop work, isolate the hazard, verify controls, and restart only after authorization.",
          "The recovered offline response did not survive final submission to the permanent assessment answer.");
      }
      const order=(await verify.query("SELECT order_status FROM assurance_orders WHERE order_id=(SELECT order_id FROM assurance_cases WHERE case_id=$1)",[journeyCaseId])).rows[0];assert.equal(order.order_status,"COMPLETED");
      const living=await verify.query("SELECT v.version,v.status FROM living_record_competencies c JOIN living_record_versions v ON v.competency_id=c.competency_id WHERE c.source_credential_id=$1 ORDER BY v.version",[c.credential_reference]);assert.deepEqual(living.rows.map(r=>r.status),COMPLETE_REASSESSMENT?["valid","reassessment_required","revoked"]:["valid","reassessment_required"]);
    } finally {await verify.close();}
    if(ASSURANCE_NOTIFICATIONS)await verifyAssuranceNotificationConsumers({root,dbDir,baseUrl,port,env,credentials,workerAccountId,journeyCaseId});
  } finally {
    await rm(dbDir, { recursive: true, force: true });
  }
});