import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const EMAIL="masterplan.worker.e2e@example.test";
const PHONE="+923001234567";
const PASSWORD="MasterplanWorker!2026";
const SANDBOX_KEY="masterplan-worker-browser-sandbox-2026";
const PNG={name:"proof.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")};
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MCQ_PROMPT="What is the first safe action when an uncontrolled hazard is identified?";
const MCQ_ANSWER="Stop work and isolate the hazard.";
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
async function approveReview(page,baseUrl,kind,reason){await page.goto(`${baseUrl}/verifier/reviews`,{waitUntil:"domcontentloaded"});const row=page.locator("tbody tr").filter({hasText:kind}).first();await row.getByRole("link",{name:"Review"}).click();await page.getByRole("button",{name:"Claim review"}).click();await page.getByText("ASSIGNED",{exact:true}).waitFor({timeout:15000});await page.getByLabel("Decision").selectOption("APPROVED");await page.getByLabel("Reason").last().fill(reason);await page.getByRole("button",{name:"Finalize review"}).click();await page.getByText("APPROVED",{exact:true}).waitFor({timeout:15000});}

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
        await worker.getByRole("button",{name:"Create Worker account"}).click();
        await worker.waitForURL(/\/worker\/register\/verify/,{timeout:15000});
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
  await database.query(`INSERT INTO assurance_policy_packs(policy_id,framework_id,policy_reference,title,policy_status,created_by_account_id,created_at,updated_at) VALUES($1,$2,'E2E-WORKER-POLICY','End-to-End Worker Policy','ACTIVE',$3,$4,$4)`,[policyId,frameworkId,admin,now]);
  await database.query(`INSERT INTO assurance_policy_versions(policy_version_id,policy_id,version_no,version_status,effective_from,effective_to,policy_values,override_allowed_fields,override_directions,created_by_account_id,created_at) VALUES($1,$2,1,'PUBLISHED','2026-01-01T00:00:00Z',NULL,$3::jsonb,'[]'::jsonb,'{}'::jsonb,$4,$5)`,[policyVersionId,policyId,JSON.stringify({pass_mark:70}),admin,now]);
  await database.query(`INSERT INTO assessment_blueprints(blueprint_id,blueprint_reference,blueprint_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'BP-E2E-WORKER','INACTIVE',NULL,$2,$3,$3)`,[blueprintId,admin,now]);
  await database.query(`INSERT INTO assessment_blueprint_versions(blueprint_version_id,blueprint_id,version_no,framework_id,title,selectors_json,created_by_account_id,created_at) VALUES($1,$2,1,$3,'End-to-End Worker Blueprint',$4::jsonb,$5,$6)`,[blueprintVersionId,blueprintId,frameworkId,JSON.stringify([{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:[]},{count:1,questionType:"SHORT_TEXT",tagsAll:[]}].filter(selector=>CONTENT_MODE==="COMBINED" || selector.questionType===(CONTENT_MODE==="MCQ_ONLY" ? "MULTIPLE_CHOICE" : "SHORT_TEXT"))),admin,now]);
  await database.query("UPDATE assessment_blueprints SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3 WHERE blueprint_id=$1",[blueprintId,blueprintVersionId,now]);
  await database.query(`INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,section_config_json,require_fullscreen,require_environment_declaration,require_monitoring_consent) VALUES($1,$2,$3::jsonb,FALSE,TRUE,TRUE)`,[blueprintVersionId,DELIVERY_MODE,JSON.stringify(DELIVERY_MODE==="SECTION_REVIEW" ? [{title:"Objective section",endPosition:1},{title:"Written section",endPosition:2}] : [])]);
  await database.query(`INSERT INTO assessment_catalogue_entries(catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,created_by_account_id,created_at,updated_at) VALUES($1,'CAT-E2E-WORKER','INACTIVE',NULL,$2,$3,$3)`,[catalogueId,admin,now]);
  await database.query(`INSERT INTO assessment_catalogue_versions(catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at) VALUES($1,$2,1,'End-to-End Worker Assessment','Preserved Masterplan Worker journey',$3,$4,1,$5,$6)`,[catalogueVersionId,catalogueId,frameworkId,blueprintVersionId,admin,now]);
  await database.query("UPDATE assessment_catalogue_entries SET current_version_id=$2,catalogue_status='ACTIVE',updated_at=$3 WHERE catalogue_entry_id=$1",[catalogueId,catalogueVersionId,now]);
  for(const [seed,type,prompt,answer,rubric] of [["mcq","MULTIPLE_CHOICE",MCQ_PROMPT,MCQ_ANSWER,null],["written","SHORT_TEXT",WRITTEN_PROMPT,null,{maxScore:100,criteria:[{description:"Identifies controlled verification before restart",points:100}]}]]){
    const qid=stableId("assessment_question",`masterplan-${seed}`),vid=stableId("question_version",`masterplan-${seed}`),fp=createHash("sha256").update(`${type}:${prompt}`).digest("hex");
    await database.query(`INSERT INTO assessment_questions(question_id,question_reference,question_status,current_version_id,current_content_fingerprint,created_by_account_id,created_at,updated_at) VALUES($1,$2,'INACTIVE',NULL,NULL,$3,$4,$4)`,[qid,`E2E-Q-${seed.toUpperCase()}`,admin,now]);
    await database.query(`INSERT INTO assessment_question_versions(question_version_id,question_id,version_no,question_type,prompt,options_json,answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,content_fingerprint,created_by_account_id,created_at) VALUES($1,$2,1,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,'Hazard Control','MEDIUM','[]'::jsonb,$9,$10,$11)`,[vid,qid,type,prompt,type==="MULTIPLE_CHOICE"?JSON.stringify([MCQ_ANSWER,"Continue working and report later."]):null,answer===null?null:JSON.stringify(answer),rubric===null?null:JSON.stringify(rubric),frameworkId,fp,admin,now]);
    await database.query("UPDATE assessment_questions SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE',updated_at=$4 WHERE question_id=$1",[qid,vid,fp,now]);
  }
  if(process.env.HSE_MASTERPLAN_RECOVERY_MODE === "replacement") {
    for(const [seed,type,prompt] of [["spare-mcq","MULTIPLE_CHOICE",MCQ_PROMPT+" Replacement bank variant."],["spare-written","SHORT_TEXT",WRITTEN_PROMPT+" Replacement bank variant."]]) {
      const qid=stableId("assessment_question",seed),vid=stableId("question_version",seed),fp=createHash("sha256").update(prompt).digest("hex");
      await database.query(`INSERT INTO assessment_questions(question_id,question_reference,question_status,current_version_id,current_content_fingerprint,created_by_account_id,created_at,updated_at) VALUES($1,$2,'INACTIVE',NULL,NULL,$3,NOW(),NOW())`,[qid,seed,admin]);
      await database.query(`INSERT INTO assessment_question_versions(question_version_id,question_id,version_no,question_type,prompt,options_json,answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,content_fingerprint,created_by_account_id,created_at)
        SELECT $1,$2,1,question_type,$3,options_json,answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,$4,created_by_account_id,NOW() FROM assessment_question_versions WHERE question_type=$5 LIMIT 1`,[vid,qid,prompt,fp,type]);
      await database.query("UPDATE assessment_questions SET question_status='ACTIVE',current_version_id=$2,current_content_fingerprint=$3 WHERE question_id=$1",[qid,vid,fp]);
    }
  }
  await database.query("UPDATE assessor_assignment_profiles SET profile_status='PAUSED' WHERE assessor_account_id<>$1",[assessor]);
  await database.query(`INSERT INTO assessor_assignment_profiles(assessor_account_id,trade_scopes,qualification_scopes,languages,jurisdictions,risk_levels,availability_json,max_active_interviews,profile_status,updated_at) VALUES($1,'["*"]'::jsonb,'["*"]'::jsonb,'["*"]'::jsonb,'["*"]'::jsonb,'["*"]'::jsonb,'{}'::jsonb,8,'ACTIVE',$2) ON CONFLICT(assessor_account_id) DO UPDATE SET profile_status='ACTIVE',trade_scopes='["*"]'::jsonb,qualification_scopes='["*"]'::jsonb,languages='["*"]'::jsonb,jurisdictions='["*"]'::jsonb,risk_levels='["*"]'::jsonb,updated_at=$2`,[assessor,now]);
  await database.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,created_at) VALUES($1,$2,'assessor','E2E-WORKER','CURRENT','2026-01-01T00:00:00Z','2027-12-31T00:00:00Z','Current framework calibration for preserved E2E interview matching.',$3,$4)`,[stableId("staff_calibration","masterplan-worker-e2e"),assessor,admin,now]);
  return {catalogueVersionId};
}

test("Masterplan preserved Worker journey: register to credential, share and appeal on one record",{timeout:420000},async()=>{
  const companyFunded=process.env.HSE_MASTERPLAN_FUNDING_MODE === "company";
  const root=process.cwd(),dbDir=await mkdtemp(join(tmpdir(),"hse-masterplan-worker-e2e-")),port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
  const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dbDir,HSE_RELEASE_SHA:"masterplan-worker-e2e",HSE_SESSION_SECRET:"masterplan-worker-e2e-session-secret-2026-more-than-32",HSE_AUTH_PEPPER:"masterplan-worker-e2e-auth-pepper-2026-more-than-32",HSE_ENABLE_AUTH_SANDBOX:"true",HSE_AUTH_SANDBOX_ACCESS_KEY:SANDBOX_KEY,HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  try{
    const migration=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{cwd:root,env,encoding:"utf8"});assert.equal(migration.status,0,migration.stderr||migration.stdout);
    const seed=spawnSync(process.execPath,["scripts/independent-audit-seed.mjs"],{cwd:root,env,encoding:"utf8"});assert.equal(seed.status,0,seed.stderr||seed.stdout);
    const credentials=JSON.parse(await readFile("/tmp/independent-audit-credentials.json","utf8"));
    const phase1=await phaseOne(baseUrl,env,credentials);console.log("JOURNEY: identity and evidence verified");assert.equal(phase1.requestedSignal,"SMOKE_COMPLETE");
    const db=new PGlite(dbDir);
    let workerAccountId,permanentWorkerId,companyTenantId;
    try{
      workerAccountId=(await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[EMAIL])).rows[0]?.account_id;
      permanentWorkerId=(await db.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",[workerAccountId])).rows[0]?.permanent_worker_id;
      assert.ok(workerAccountId);assert.match(permanentWorkerId,/^worker_id_/);
      await seedAssessment(db,credentials);
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
          await login(admin,baseUrl,credentials.admin,"admin");
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

          await assessor.goto(`${baseUrl}${href}`);await assessor.getByRole("button",{name:"Claim interview"}).click();await assessor.getByRole("button",{name:"Admit ready Worker"}).waitFor({timeout:20000});await assessor.getByRole("button",{name:"Admit ready Worker"}).click();await assessor.getByRole("button",{name:"Start interview"}).waitFor({timeout:20000});await assessor.getByRole("button",{name:"Start interview"}).click();await assessor.getByLabel(/I allow this browser to use my camera and microphone/).check();await assessor.getByRole("button",{name:"Enable camera & microphone"}).click();await assessor.getByText("Waiting for worker to join",{exact:true}).waitFor({timeout:20000});
          await assessor.getByLabel("Assessor follow-up question").fill("Describe how you would verify the area remains controlled before restart.");await assessor.getByRole("button",{name:"Add versioned follow-up"}).click();await assessor.getByLabel("Pause reason").fill("Controlled pause to verify the candidate connection.");await assessor.getByRole("button",{name:"Pause interview"}).click();await assessor.getByRole("button",{name:"Resume interview"}).waitFor({timeout:15000});await assessor.getByRole("button",{name:"Resume interview"}).click();
          for(const label of ["Technical knowledge","Practical reasoning","Safety awareness","Communication","Consistency with written answers","Confidence / clarity","Trade judgment"])await assessor.getByLabel(label).fill("5");
          await assessor.getByLabel("Notes",{exact:true}).fill("Candidate consistently explained controlled isolation and verification.");await assessor.getByLabel("Scorecard comments").fill("Strong evidence-based interview.");await assessor.locator('select[name="recommendation"]').selectOption("PASS");await assessor.getByRole("button",{name:"Save draft"}).click();await assessor.waitForFunction(()=>document.querySelector('select[name="recommendation"]')?.value==="PASS");await assessor.getByRole("button",{name:"End interview"}).waitFor({timeout:15000});await assessor.getByRole("button",{name:"End interview"}).click();await assessor.getByRole("button",{name:"Submit final recommendation"}).waitFor({timeout:15000});const finalForm=assessor.getByRole("button",{name:"Submit final recommendation"}).locator("xpath=ancestor::form");const validity=await finalForm.evaluate((form)=>({valid:form.checkValidity(),invalid:[...form.querySelectorAll(":invalid")].map((el)=>({name:el.getAttribute("name"),value:(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement)?el.value:null}))}));assert.equal(validity.valid,true,"Final interview form invalid: "+JSON.stringify(validity.invalid));await assessor.getByRole("button",{name:"Submit final recommendation"}).click();try{await assessor.getByText(/Final interview record submitted and locked/).waitFor({timeout:20000});}catch(error){throw new Error("Final recommendation transaction failed.\nASSESSOR:\n"+await assessor.locator("body").innerText()+"\nSERVER:\n"+output(),{cause:error});}

          await admin.goto(`${baseUrl}/admin/decisions?tenantId=${journeyTenantId}&caseId=${journeyCaseId}`,{waitUntil:"domcontentloaded"});const decisionForm=admin.locator("form").filter({has:admin.getByRole("button",{name:"Create decision"})});await decisionForm.getByLabel("State").selectOption("APPROVED");await decisionForm.getByLabel("Reason code").fill("all_stages_passed");await decisionForm.getByLabel("Explanation").fill("Identity, qualification, assessment, human scoring and structured interview are all complete.");await decisionForm.getByLabel("Rule version").fill("masterplan-e2e-v1");await decisionForm.getByLabel("Input references").fill(`${attemptId},${interviewId}`);await decisionForm.getByRole("button",{name:"Create decision"}).click();await admin.getByRole("heading",{name:"APPROVED",exact:true}).waitFor({timeout:20000});

          await worker.goto(`${baseUrl}/worker/passport`);await worker.getByText("End-to-End Worker Assessment",{exact:true}).first().waitFor({timeout:20000});await worker.getByText(/valid · no expiry recorded/i).waitFor();
          await worker.goto(`${baseUrl}/worker/appeals`);const credentialOption=worker.locator('select[name="credentialId"] option').filter({hasText:"End-to-End Worker Assessment"});const credentialId=await credentialOption.getAttribute("value");assert.ok(credentialId?.startsWith("credential_id_"));
          const publicPage=await workerContext.newPage();const publicResponse=await publicPage.goto(`${baseUrl}/verify/result/${credentialId}`,{waitUntil:"domcontentloaded"});assert.equal(publicResponse?.status(),200);await publicPage.getByText("End-to-End Worker Assessment",{exact:true}).waitFor();const publicApi=await publicPage.request.get(`${baseUrl}/api/credentials/${credentialId}`);assert.equal(publicApi.status(),200);assert.equal((await publicApi.json()).status,"valid");
          const pdf=await publicPage.request.get(`${baseUrl}/api/credentials/${credentialId}/pdf`);assert.equal(pdf.status(),200);assert.match(pdf.headers()["content-type"],/application\/pdf/);assert.ok((await pdf.body()).subarray(0,8).toString().startsWith("%PDF-1.4"));await publicPage.close();

          await worker.goto(`${baseUrl}/worker/share-links`);await worker.getByLabel("Competencies", { exact: true }).check();await worker.getByLabel("Purpose").fill("Masterplan end-to-end verification");await worker.getByLabel("Recipient or employer (optional)").fill("E2E Employer");await worker.getByLabel("Link expiry").selectOption("7");await worker.getByRole("button",{name:"Create secure link"}).click();await worker.getByText("Share link created.",{exact:false}).waitFor({timeout:15000});const shareUrl=await worker.getByRole("link",{name:"Open secure share link"}).getAttribute("href");assert.ok(shareUrl);const share=await workerContext.newPage();await share.goto(`${baseUrl}${shareUrl}`);await share.getByText("End-to-End Worker Assessment",{exact:true}).waitFor({timeout:15000});await share.close();

          await worker.goto(`${baseUrl}/worker/appeals`);await worker.getByLabel("Credential").selectOption(credentialId);await worker.getByLabel("Appeal grounds").fill("The issued competency should be reassessed against the retained qualification evidence after this end-to-end verification.");await worker.locator('input[name="evidenceRecordIds"]').first().check();await worker.getByRole("button",{name:"Submit credential appeal"}).click();await worker.getByText("Appeal submitted for independent review.",{exact:true}).waitFor({timeout:15000});
          await admin.goto(`${baseUrl}/admin/appeals`);let appeal=admin.locator("article").filter({hasText:credentialId}).first();await appeal.getByLabel("Review status").selectOption("under_review");await appeal.getByLabel("Accepted-outcome action").selectOption("none");await appeal.getByLabel("Reasoned review outcome").fill("Independent review opened against the original issued credential and retained qualification evidence.");await appeal.getByRole("button",{name:"Record appeal review"}).click();await appeal.getByText(/^Status: under review · Version/).waitFor({timeout:15000});await admin.reload();appeal=admin.locator("article").filter({hasText:credentialId}).first();await appeal.getByLabel("Review status").selectOption("accepted");await appeal.getByLabel("Accepted-outcome action").selectOption("reassessment");await appeal.getByLabel("Reasoned review outcome").fill("Appeal accepted; competency reassessment is required before returning the Living Record to valid.");await appeal.getByRole("button",{name:"Record appeal review"}).click();await appeal.getByText(/^Status: accepted · Version/).waitFor({timeout:15000});
          await worker.goto(`${baseUrl}/worker/passport`);await worker.getByText(/reassessment required · no expiry recorded/i).waitFor({timeout:20000});await worker.getByText(/Version 2 · reassessment required/i).waitFor();

          assert.deepEqual(errors.filter(e=>!e.includes("favicon") && !((process.env.HSE_MASTERPLAN_OFFLINE_RECOVERY === "true" || process.env.HSE_MASTERPLAN_MCQ_OFFLINE === "true") && e === "Failed to load resource: net::ERR_INTERNET_DISCONNECTED")),[],`Browser errors:\n${errors.join("\n")}\n${output()}`);
          return {credentialId,interviewId,attemptId,originalAttemptId};
        } finally {await companyContext.close();await workerContext.close();await verifierContext.close();await assessorContext.close();await adminContext.close();await browser.close();}
      }
    });
    assert.equal(phase2.requestedSignal,"SMOKE_COMPLETE");

    console.log("JOURNEY: credential, sharing and appeal completed");
    const reassessmentDb=new PGlite(dbDir);
    try {
      for(const [seed,type] of [["reassess-mcq","MULTIPLE_CHOICE"],["reassess-written","SHORT_TEXT"]]) {
        const qid=stableId("assessment_question",seed),vid=stableId("question_version",seed),prompt=`Fresh reassessment ${type} question: identify and control the hazard.`,fp=createHash("sha256").update(prompt).digest("hex");
        await reassessmentDb.query(`INSERT INTO assessment_questions(question_id,question_reference,question_status,current_version_id,current_content_fingerprint,created_by_account_id,created_at,updated_at) VALUES($1,$2,'INACTIVE',NULL,NULL,$3,NOW(),NOW())`,[qid,seed,credentials.admin.accountId]);
        await reassessmentDb.query(`INSERT INTO assessment_question_versions(question_version_id,question_id,version_no,question_type,prompt,options_json,answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,content_fingerprint,created_by_account_id,created_at)
          SELECT $1,$2,1,question_type,$3,options_json,answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,$4,created_by_account_id,NOW() FROM assessment_question_versions WHERE question_type=$5 LIMIT 1`,[vid,qid,prompt,fp,type]);
        await reassessmentDb.query("UPDATE assessment_questions SET question_status='ACTIVE',current_version_id=$2,current_content_fingerprint=$3 WHERE question_id=$1",[qid,vid,fp]);
      }
    } finally {await reassessmentDb.close();}
    const reassessment=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:`${baseUrl}/worker/login`,projectRoot:root,environment:env,
      probe:async()=>{const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await login(page,baseUrl,{email:EMAIL,password:PASSWORD},"worker");await page.goto(`${baseUrl}/worker/assessment-applications`);
        await page.getByRole("button",{name:"Apply — worker pays"}).click();await page.getByText("Application created. Complete the sandbox self-payment confirmation to fund the assessment.",{exact:true}).waitFor({timeout:20000});
        await page.getByText("Status: COMPLETED",{exact:true}).waitFor();await page.getByText("Status: PAYMENT REQUIRED",{exact:true}).waitFor();
      } finally {await browser.close();}}});assert.equal(reassessment.requestedSignal,"SMOKE_COMPLETE");

    const verify=new PGlite(dbDir);try{
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
      const living=await verify.query("SELECT v.version,v.status FROM living_record_competencies c JOIN living_record_versions v ON v.competency_id=c.competency_id WHERE c.source_credential_id=$1 ORDER BY v.version",[c.credential_reference]);assert.deepEqual(living.rows.map(r=>r.status),["valid","reassessment_required"]);
    } finally {await verify.close();}
  } finally {
    await rm(dbDir, { recursive: true, force: true });
  }
});