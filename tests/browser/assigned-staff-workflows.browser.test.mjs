import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { authorizeReviewFixture } from "../helpers/evidence-review-calibration-fixture.mjs";
import { ATTEMPT_NOW, seedInProgressAttempt, seedWorkerPrincipal, stableId } from "../helpers/assessment-attempt-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { StaffCalibrationService } = loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const { AssessmentAttemptService } = loadWorkerRegistrationTs("src/lib/assessment-attempt/assessment-attempt-service.ts");

const PASSWORD="AssignedWork!2026", SANDBOX_KEY="assigned-work-browser-key-2026";
function base32(v){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b="";for(const c of v.toUpperCase().replace(/=+$/g,""))b+=a.indexOf(c).toString(2).padStart(5,"0");const x=[];for(let i=0;i+8<=b.length;i+=8)x.push(parseInt(b.slice(i,i+8),2));return Buffer.from(x)}
function totp(secret,step=0){const n=Math.floor(Date.now()/30000)+step,m=Buffer.alloc(8);m.writeBigUInt64BE(BigInt(n));const d=createHmac("sha1",base32(secret)).update(m).digest(),o=d.at(-1)&15;return String((d.readUInt32BE(o)&0x7fffffff)%1e6).padStart(6,"0")}
async function freePort(){return new Promise((ok,no)=>{const s=createServer();s.once("error",no);s.listen(0,"127.0.0.1",()=>{const a=s.address();if(!a||typeof a==="string")return no(new Error("port"));s.close(e=>e?no(e):ok(a.port))})})}
async function goto(page,url,path,text){const r=await page.goto(url+path,{waitUntil:"domcontentloaded"});assert(r&&r.status()<500,`${path}: ${r?.status()}`);if(text)await page.getByText(text,{exact:false}).first().waitFor({timeout:15000})}
async function enroll(browser,url,path,role,email){
 const c=await browser.newContext(),p=await c.newPage();await goto(p,url,path,"Create account credentials");
 await p.getByLabel("Full name").fill("Assigned "+role);await p.getByLabel("Create password").fill(PASSWORD);await p.getByLabel("Confirm password").fill(PASSWORD);
 await p.getByRole("button",{name:"Continue to authenticator setup"}).click();const secret=(await p.locator(".security-key-card strong").innerText()).trim();
 await p.getByLabel("Authenticator code").fill(totp(secret));await p.getByRole("button",{name:"Activate MFA and finish enrollment"}).click();await p.getByText("Enrollment complete",{exact:false}).waitFor();await c.close();return{role,email,secret}
}
async function login(browser,url,x,{media=false}={}){const c=await browser.newContext({viewport:{width:1440,height:1000},permissions:media?["camera","microphone"]:[]}),p=await c.newPage();await goto(p,url,`/${x.role}/login`,"sign in");await p.getByLabel("Email address").fill(x.email);await p.getByLabel("Password").fill(PASSWORD);await p.getByLabel("Authenticator code").fill(totp(x.secret,1));await p.getByRole("button",{name:"Sign in"}).click();await p.waitForURL(`**/${x.role}/dashboard`);return{c,p}}
async function provision(url){
 const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});try{
  const p=await browser.newPage();await goto(p,url,"/auth/sandbox/bootstrap-root","Create the one-time invitation");await p.getByLabel("First root email").fill("root.assigned@example.test");await p.getByLabel("Authentication sandbox access key").fill(SANDBOX_KEY);await p.getByRole("button",{name:"Create first root invitation"}).click();const ri=(await p.locator(".security-key-card strong").innerText()).trim();await p.close();
  const root=await enroll(browser,url,ri,"root","root.assigned@example.test"),rs=await login(browser,url,root);await goto(rs.p,url,"/root/staff","Create invitation");
  const ids=[];let prior="";
  for(const role of ["verifier","assessor"]){const email=`${role}.assigned@example.test`;await rs.p.getByLabel("Staff email").fill(email);await rs.p.getByLabel("Portal role").selectOption(role);await rs.p.getByRole("button",{name:"Create one-time invitation"}).click();await rs.p.waitForFunction(pr=>{const v=document.querySelector(".security-key-card strong")?.textContent?.trim()||"";return v.startsWith("/staff/invite/")&&v!==pr},prior);const inv=(await rs.p.locator(".security-key-card strong").first().innerText()).trim();prior=inv;ids.push(await enroll(browser,url,inv,role,email))}
  await rs.c.close();return ids;
 }finally{await browser.close()}
}
const id=(p,c)=>p+"_"+c.repeat(24);
async function seed(dir){
 const db=new PGlite(dir);try{
  const accounts=await db.query("SELECT account_id,email_normalized FROM auth_accounts WHERE email_normalized IN ('verifier.assigned@example.test','assessor.assigned@example.test')");
  const by=Object.fromEntries(accounts.rows.map(r=>[r.email_normalized,r.account_id]));assert(by["verifier.assigned@example.test"]);assert(by["assessor.assigned@example.test"]);
  const now="2026-09-19T12:00:00.000Z",tenant=id("tenant","T"),worker="account_worker_assigned";
  const evidenceOrder=id("assurance_order","E"),evidenceTarget=id("assurance_target","G"),evidenceCase=id("assurance_case","C");
  const obs=id("supervisor_observation","S"),task=id("evidence_review","R"),conflictTask=id("evidence_review","Q"),interview=id("interview_request","I");
  await db.query("INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_at,updated_at,activated_at) VALUES($1,'company','Assigned Tenant','active',$2,$2,$2)",[tenant,now]);

  // Evidence-review case: approval legitimately advances to the assessment stage.
  await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,requested_identity_checks,requested_evidence_checks,assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,'Assigned Evidence Order','ASSIGNED-EVIDENCE','[]','[]','[\"FRAMEWORK-EVIDENCE\"]',FALSE,'SUBMITTED',$4,$4,$4)",[evidenceOrder,tenant,id("membership","M"),now]);
  await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)",[evidenceTarget,evidenceOrder,tenant,id("company_worker_link","L"),worker,now]);
  await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Review pending','reviewer','Review assigned evidence.',$7,$7)",[evidenceCase,evidenceOrder,evidenceTarget,tenant,id("company_worker_link","L"),worker,now]);
  await db.query("INSERT INTO supervisor_observations(observation_id,tenant_id,case_id,worker_account_id,competency_reference,observer_membership_id,observed_at,observation_text,outcome,created_at) VALUES($1,$2,$3,$4,'COMP-1',$5,$6,'Worker safely demonstrated the assigned competency without prompting.','demonstrated',$6)",[obs,tenant,evidenceCase,worker,id("membership","M"),now]);
  await db.query("INSERT INTO supervisor_observation_details(observation_id,framework_reference,task_reference,checklist_json,restrictions,supervisor_declaration,supervisor_signed_at,worker_acknowledged_at,worker_comment,created_at,updated_at) VALUES($1,'FRAMEWORK-EVIDENCE','COMP-1-TASK',$2::jsonb,NULL,'I confirm this observation is complete, accurate and attributable.',$3,$3,'Worker acknowledged the signed observation.',$3,$3)",[obs,JSON.stringify(["Isolation sequence observed","Stop-work condition explained"]),now]);
  await db.query("INSERT INTO evidence_review_tasks(task_id,tenant_id,case_id,worker_account_id,evidence_kind,source_record_id,source_version_id,evidence_label,task_status,created_at,updated_at) VALUES($1,$2,$3,$4,'supervisor_observation',$5,$5,'Assigned observation','QUEUED',$6,$6)",[task,tenant,evidenceCase,worker,obs,now]);
  await db.query("INSERT INTO evidence_review_tasks(task_id,tenant_id,case_id,worker_account_id,evidence_kind,source_record_id,source_version_id,evidence_label,task_status,created_at,updated_at) VALUES($1,$2,$3,$4,'skill',$5,$5,'Conflict declaration fixture','QUEUED',$6,$6)",[conflictTask,tenant,evidenceCase,worker,"skill_conflict_version_001",now]);
  const verifierForCalibration={accountId:by["verifier.assigned@example.test"]};
  await authorizeReviewFixture(db,{taskId:task,verifiers:[verifierForCalibration],at:new Date(now)});
  await authorizeReviewFixture(db,{taskId:conflictTask,verifiers:[verifierForCalibration],at:new Date(now)});

  // Written scoring uses an actual submitted attempt, pinned rubric and exact framework calibration.
  const scoringWorker=await seedWorkerPrincipal(db,"assigned-staff-scoring");
  const scoring=await seedInProgressAttempt(db,scoringWorker,"assigned-staff-scoring",[
   {questionType:"LONG_TEXT",prompt:"Explain the hazard isolation controls for the assigned task.",rubric:{maxScore:10,criteria:[{description:"Hazard controls",points:10}]}}
  ]);
  await db.query("UPDATE assurance_orders SET interview_required=TRUE WHERE order_id=$1",[scoring.orderId]);
  const framework=(await db.query("SELECT framework_id FROM assessment_blueprint_versions WHERE blueprint_version_id=$1",[scoring.blueprintVersionId])).rows[0].framework_id;
  let revision=(await db.query("SELECT framework_version_id,framework_reference FROM assurance_framework_revisions WHERE framework_id=$1 ORDER BY version_no DESC LIMIT 1",[framework])).rows[0];
  if(!revision){
   const meta=(await db.query("SELECT framework_reference,title FROM assurance_frameworks WHERE framework_id=$1",[framework])).rows[0];
   const frameworkVersionId=stableId("framework_revision","assigned-staff-scoring");
   await db.query("INSERT INTO assurance_framework_revisions(framework_version_id,framework_id,version_no,framework_reference,title,effective_from,recorded_by_account_id,created_at) VALUES($1,$2,1,$3,$4,$5,$6,$5)",[frameworkVersionId,framework,meta.framework_reference,meta.title,ATTEMPT_NOW,by["verifier.assigned@example.test"]]);
   revision={framework_version_id:frameworkVersionId,framework_reference:meta.framework_reference};
  }
  await db.query("INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,policy_source,effective_value_json,reference_time) VALUES($1,$2,$3,$4,$5,$6,'GLOBAL',$7::jsonb,$8)",[
   stableId("policy_snapshot","assigned-staff-scoring"),scoring.caseId,scoring.tenantId,framework,stableId("policy","assigned-staff-scoring"),stableId("policy_version","assigned-staff-scoring"),JSON.stringify({pass_mark:80}),ATTEMPT_NOW
  ]);
  const calibrationBase=await seedWorkerPrincipal(db,"assigned-staff-calibration-admin");
  await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[calibrationBase.accountId]);
  await db.query("UPDATE auth_sessions SET active_role='admin' WHERE session_id=$1",[calibrationBase.sessionId]);
  const calibrationAdmin={...calibrationBase,activeRole:"admin"};
  for(const role of ["verifier","assessor"])await new StaffCalibrationService(Promise.resolve(db)).record(calibrationAdmin,{
   accountId:by[role+".assigned@example.test"],role,frameworkReference:revision.framework_reference,frameworkVersionId:revision.framework_version_id,
   status:"CURRENT",validFrom:new Date(),validUntil:new Date("2099-01-01T00:00:00.000Z"),note:"Current staff calibration before the actual assigned assessment submission."
  });
  await db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='admin'",[calibrationAdmin.accountId]);
  const submitted=await new AssessmentAttemptService(db).submitCurrentAnswer(scoringWorker,{
   attemptId:scoring.attemptId,position:1,answer:"Stop work, isolate every energy source, lock out, tag out and verify zero energy before starting."
  },new Date(ATTEMPT_NOW),null);
  assert.equal(submitted.submitted,true);
  const reviewRow=(await db.query("SELECT review_id,reviewer_account_id,rubric_version FROM written_score_reviews WHERE attempt_id=$1 AND status='DRAFT'",[scoring.attemptId])).rows[0];
  assert.ok(reviewRow,"Assessment submission must queue a written scoring review.");
  assert.equal(reviewRow.reviewer_account_id,by["verifier.assigned@example.test"]);
  assert.equal(reviewRow.rubric_version,scoring.blueprintVersionId);
  const review=reviewRow.review_id;
  await db.query("INSERT INTO interview_requests(interview_request_id,tenant_id,case_id,worker_account_id,status,requested_at,assessor_account_id,timezone) VALUES($1,$2,$3,$4,'ASSIGNED',$5,$6,'UTC')",[
   interview,scoring.tenantId,scoring.caseId,scoringWorker.accountId,now,by["assessor.assigned@example.test"]
  ]);
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at,created_at,updated_at) VALUES($1,'worker.assigned.fixture@example.test','Assigned Worker Fixture','active',$2,$2,$2) ON CONFLICT (account_id) DO NOTHING",[worker,now]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2) ON CONFLICT (account_id,role) DO NOTHING",[worker,now]);
  return {task,conflictTask,review,interview,caseId:scoring.caseId,evidenceCase,identities:by};
 }finally{await db.close()}
}
async function scheduleInterview(url,identities){
 const browser=await chromium.launch({headless:true});try{
  const assessor=await login(browser,url,identities.find(x=>x.role==="assessor"));
  await goto(assessor.p,url,"/assessor/interviews","Interview assignments");
  const scheduledAt=new Date(Date.now()+60000).toISOString().slice(0,16);
  await assessor.p.getByLabel("Interview time").fill(scheduledAt);
  await assessor.p.getByRole("button",{name:"Schedule",exact:true}).click();
  await assessor.p.getByText(scheduledAt,{exact:false}).waitFor({timeout:15000});
  const assessorStorageState=await assessor.c.storageState();await assessor.c.close();return {scheduledAt,assessorStorageState};
 }finally{await browser.close()}
}
async function seedReadyRuntime(dir,seeded,scheduledAt){
 const db=new PGlite(dir);try{
  const appointment=await db.query("SELECT tenant_id,worker_account_id,assessor_account_id,scheduled_at FROM interview_requests WHERE interview_request_id=$1",[seeded.interview]);
  const request=appointment.rows[0];assert(request?.scheduled_at,"Actual Assessor scheduling must precede readiness");
  assert.equal(new Date(request.scheduled_at).toISOString().slice(0,16),scheduledAt);
  const now=new Date().toISOString();
  await db.query("INSERT INTO interview_runtime_sessions(interview_session_id,tenant_id,interview_request_id,worker_account_id,assessor_account_id,status,worker_ready_at,updated_at) VALUES($1,$2,$3,$4,$5,'READY',$6,$6)",["interview_session_assigned_staff_ready",request.tenant_id,seeded.interview,request.worker_account_id,request.assessor_account_id,now]);
  await db.query("UPDATE interview_requests SET ready_at=$2 WHERE interview_request_id=$1",[seeded.interview,now]);
 }finally{await db.close()}
}
async function exercise(url,identities,scheduledAt,assessorStorageState){
 const browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});try{
  const verifier=await login(browser,url,identities.find(x=>x.role==="verifier"));
  await goto(verifier.p,url,"/verifier/reviews","Evidence review queue");let reviewRow=verifier.p.locator("tr").filter({hasText:"supervisor_observation"}).first();await reviewRow.getByRole("link",{name:"Review",exact:true}).click();await verifier.p.getByRole("button",{name:"Claim review"}).click();await verifier.p.getByText("ASSIGNED",{exact:true}).waitFor();await verifier.p.getByLabel("Reason", { exact: true }).fill("Evidence is attributable, current, relevant and sufficient.");await verifier.p.getByRole("button",{name:"Finalize review"}).click();await verifier.p.getByText("APPROVED",{exact:true}).waitFor();
  await goto(verifier.p,url,"/verifier/reviews","Evidence review queue");const conflictRow=verifier.p.locator("tr").filter({hasText:"skill"}).first();await conflictRow.getByRole("link",{name:"Review",exact:true}).click();await verifier.p.getByLabel("Conflict reason").fill("Prior involvement creates a reviewer independence conflict.");await verifier.p.getByRole("button",{name:"Declare conflict"}).click();await verifier.p.getByText("QUEUED",{exact:true}).waitFor();
  await goto(verifier.p,url,"/verifier/reviews/scoring","Written scoring review");const rubricForm=verifier.p.getByRole("form",{name:"Rubric mark Q1:C0"});await rubricForm.getByLabel("Criterion mark").fill("84");await rubricForm.getByLabel("Mark reason").fill("Hazard isolation sequence is complete and technically correct.");await rubricForm.getByRole("button",{name:"Save mark"}).click();await verifier.p.reload({waitUntil:"domcontentloaded"});const scoringForm=verifier.p.locator("form").filter({hasText:"Save scoring decision"}).first();await scoringForm.getByLabel("Decision").selectOption("PASS");await scoringForm.getByRole("textbox",{name:"Reason",exact:true}).fill("Saved through the real Verifier scoring form after the reasoned criterion mark.");await scoringForm.getByRole("button",{name:"Save scoring decision"}).click();await verifier.p.reload({waitUntil:"domcontentloaded"});await verifier.p.getByRole("button",{name:"Finalize review"}).click();await verifier.p.getByText("FINAL",{exact:true}).waitFor();await verifier.c.close();
  const assessorContext=await browser.newContext({storageState:assessorStorageState,viewport:{width:1440,height:1000},permissions:["camera","microphone"]}),assessor={c:assessorContext,p:await assessorContext.newPage()};await goto(assessor.p,url,"/assessor/interviews","Interview assignments");await assessor.p.getByText(scheduledAt,{exact:false}).waitFor({timeout:15000});await assessor.p.getByRole("link",{name:"Open interview console"}).click();await assessor.p.getByText("Provider: Built-in WebRTC",{exact:true}).waitFor({timeout:15000});await assessor.p.getByRole("button",{name:"Claim interview"}).click();await assessor.p.getByRole("button",{name:"Admit ready Worker"}).waitFor({timeout:15000});await assessor.p.getByRole("button",{name:"Admit ready Worker"}).click();await assessor.p.getByRole("button",{name:"Start interview"}).waitFor({timeout:15000});await assessor.p.getByRole("button",{name:"Start interview"}).click();await assessor.p.getByRole("button",{name:"End interview"}).waitFor({timeout:15000});await assessor.p.getByLabel(/I allow this browser to use my camera and microphone/i).check();await assessor.p.getByRole("button",{name:"Enable camera & microphone"}).click();await assessor.p.getByText("Waiting for worker to join",{exact:true}).waitFor({timeout:15000});await assessor.p.getByRole("tab",{name:"Notes and scoring",exact:true}).click();await assessor.p.getByRole("textbox",{name:"Notes",exact:true}).fill("Worker explained the safe isolation sequence clearly.");await assessor.p.getByLabel("Technical knowledge").fill("5");await assessor.p.getByLabel("Practical reasoning").fill("5");await assessor.p.getByLabel("Safety awareness").fill("5");await assessor.p.getByLabel("Communication").fill("5");await assessor.p.getByLabel("Consistency with written answers").fill("5");await assessor.p.getByLabel("Confidence / clarity").fill("5");await assessor.p.getByLabel("Trade judgment").fill("5");await assessor.p.getByRole("textbox",{name:"Scorecard comments",exact:true}).fill("Strong evidence-based answers.");await assessor.p.locator('select[name="recommendation"]').selectOption("PASS");await Promise.all([assessor.p.waitForResponse(x=>x.request().method()==="POST"&&x.url().includes("/assessor/interviews/")),assessor.p.getByRole("button",{name:"Save draft"}).click()]);await assessor.p.reload({waitUntil:"domcontentloaded"});await assessor.p.getByRole("tab",{name:"Notes and scoring",exact:true}).click();assert.equal(await assessor.p.getByRole("textbox",{name:"Notes",exact:true}).inputValue(),"Worker explained the safe isolation sequence clearly.");assert.equal(await assessor.p.getByLabel("Technical knowledge").inputValue(),"5");assert.equal(await assessor.p.getByLabel("Safety awareness").inputValue(),"5");assert.equal(await assessor.p.getByLabel("Practical reasoning").inputValue(),"5");assert.equal(await assessor.p.getByLabel("Communication").inputValue(),"5");assert.equal(await assessor.p.getByLabel("Consistency with written answers").inputValue(),"5");assert.equal(await assessor.p.getByLabel("Confidence / clarity").inputValue(),"5");assert.equal(await assessor.p.getByLabel("Trade judgment").inputValue(),"5");assert.equal(await assessor.p.locator('select[name="recommendation"]').inputValue(),"PASS");await assessor.p.getByRole("button",{name:"End interview"}).click();await assessor.p.getByRole("tab",{name:"Notes and scoring",exact:true}).click();await assessor.p.waitForFunction(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent?.includes("Submit final recommendation"));return Boolean(b&&!b.disabled)});await Promise.all([assessor.p.waitForResponse(x=>x.request().method()==="POST"&&x.url().includes("/assessor/interviews/")),assessor.p.getByRole("button",{name:"Submit final recommendation"}).click()]);await assessor.p.getByText("Final interview record submitted and locked.",{exact:true}).waitFor({timeout:15000});await assessor.c.close();
 }finally{await browser.close()}
}
async function verifyDb(dir,seeded){const db=new PGlite(dir);try{const [d,conflict,m,w,i]=await Promise.all([db.query("SELECT outcome FROM evidence_review_decisions WHERE task_id=$1",[seeded.task]),db.query("SELECT reason FROM evidence_review_conflicts WHERE task_id=$1",[seeded.conflictTask]),db.query("SELECT criterion,mark FROM written_score_rubric_marks WHERE review_id=$1",[seeded.review]),db.query("SELECT status,score,decision,reason FROM written_score_reviews WHERE review_id=$1",[seeded.review]),db.query("SELECT status,scheduled_at FROM interview_requests WHERE interview_request_id=$1",[seeded.interview])]);assert.equal(d.rows[0].outcome,"APPROVED");assert.match(conflict.rows[0]?.reason,/reviewer independence conflict/);assert.equal(m.rows[0].criterion,"Q1:C0");assert.equal(Number(m.rows[0].mark),84);assert.equal(w.rows[0].status,"FINAL");assert.equal(Number(w.rows[0].score),84);assert.equal(w.rows[0].decision,"PASS");assert.match(w.rows[0].reason,/real Verifier scoring form/);assert.equal(i.rows[0].status,"COMPLETED");assert(i.rows[0].scheduled_at);const evidenceCaseState=await db.query("SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1",[seeded.evidenceCase]);assert.equal(evidenceCaseState.rows[0].case_status,"Assessment pending");assert.equal(evidenceCaseState.rows[0].owner_kind,"background_job");assert.match(evidenceCaseState.rows[0].next_action,/framework and effective-policy evaluation/i);const c=await db.query("SELECT notes,scorecard,recommendation,submitted FROM interview_console_drafts WHERE interview_request_id=$1",[seeded.interview]);assert.equal(c.rows.length,1);assert.equal(c.rows[0].recommendation,"PASS");assert.equal(c.rows[0].submitted,true);const caseState=await db.query("SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1",[seeded.caseId]);assert.equal(caseState.rows[0].case_status,"Decision pending");assert.equal(caseState.rows[0].owner_kind,"admin");assert.match(caseState.rows[0].next_action,/final Assurance Case decision/i);const signals=await db.query("SELECT actor_role,signal_kind FROM interview_media_signals WHERE interview_request_id=$1 ORDER BY created_at,signal_id",[seeded.interview]);assert(signals.rows.some(row=>row.actor_role==="assessor"&&row.signal_kind==="offer"),"Assessor browser did not persist a WebRTC offer signal.")}finally{await db.close()}}
test("assigned Verifier and Assessor complete persisted cross-tenant work in Chromium",{timeout:300000},async()=>{
 const root=process.cwd(),dir=await mkdtemp(join(tmpdir(),"hse-assigned-work-")),port=await freePort(),url=`http://127.0.0.1:${port}`,env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,HSE_RELEASE_SHA:"assigned-work-browser",HSE_SESSION_SECRET:"assigned-work-session-secret-2026-000000000000",HSE_AUTH_PEPPER:"assigned-work-auth-pepper-2026-000000000000",HSE_ENABLE_AUTH_SANDBOX:"true",HSE_AUTH_SANDBOX_ACCESS_KEY:SANDBOX_KEY,HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 try{const m=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{cwd:root,env,encoding:"utf8"});assert.equal(m.status,0,m.stderr||m.stdout);let identities;let r=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:url+"/root/login",projectRoot:root,environment:env,probe:async()=>{identities=await provision(url)}});assert.equal(r.requestedSignal,"SMOKE_COMPLETE");const seeded=await seed(dir);let scheduledAt,assessorStorageState;r=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:url+"/assessor/login",projectRoot:root,environment:env,probe:async()=>{({scheduledAt,assessorStorageState}=await scheduleInterview(url,identities))}});assert.equal(r.requestedSignal,"SMOKE_COMPLETE");await seedReadyRuntime(dir,seeded,scheduledAt);r=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:url+"/verifier/login",projectRoot:root,environment:env,probe:async()=>exercise(url,identities,scheduledAt,assessorStorageState)});assert.equal(r.requestedSignal,"SMOKE_COMPLETE");await verifyDb(dir,seeded)}finally{await rm(dir,{recursive:true,force:true})}
});