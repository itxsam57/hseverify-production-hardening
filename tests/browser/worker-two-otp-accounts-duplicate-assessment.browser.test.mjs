import assert from "node:assert/strict";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {reportCompanyFixture} from "../helpers/report-company-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {prepareSubmittedWorker,advanceThroughAutomatedChecks,markVerified} from "../helpers/duplicate-identity-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const sandboxKey="isolated-two-worker-otp-2026";
const workers=[
 {email:"cross-otp-worker-one@example.test",phone:"+923009994201",password:"WorkerOtp!Original2026"},
 {email:"cross-otp-worker-two@example.test",phone:"+923009994202",password:"WorkerOtp!Second2026"}
];
const legal={legalFirstName:"Nida",legalLastName:"Ahmed",dateOfBirth:"1988-03-13"};
async function port(){return new Promise((resolve,reject)=>{
 const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{
  const a=s.address();s.close(e=>e?reject(e):!a||typeof a==="string"?reject(new Error("No port")):resolve(a.port));
 });
});}
async function register(page,inbox,url,person){
 await page.goto(url+"/worker/register");
 await page.getByLabel("Full name").fill("Registered Worker");
 await page.getByLabel("Email address").fill(person.email);
 await page.getByLabel("Mobile phone").fill(person.phone);
 await page.getByLabel("Country",{exact:true}).fill("Pakistan");
 await page.getByLabel("Create password").fill(person.password);
 await page.getByLabel("Confirm password").fill(person.password);
 await page.getByLabel("I accept the HSE Verify terms for this Worker account.",{exact:true}).check();
 await page.getByLabel("I accept the privacy notice for Worker registration data.",{exact:true}).check();
 await page.getByRole("button",{name:"Create Worker account",exact:true}).click();
 await page.waitForURL("**/worker/register/verify");
 for(const [channel,destination] of [["email",person.email],["phone",person.phone]]){
  await inbox.goto(url+"/worker/register/sandbox");
  await inbox.getByLabel("Delivery channel").selectOption(channel);
  await inbox.getByLabel("Delivery destination").fill(destination);
  await inbox.getByLabel("Sandbox access key").fill(sandboxKey);
  await inbox.getByRole("button",{name:"Open latest sandbox delivery"}).click();
  const status=inbox.getByRole("status",{name:"Latest sandbox verification code"});
  await status.waitFor();
  const code=(await status.locator("strong").innerText()).trim();
  await page.goto(url+"/worker/register/verify");
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button",{name:"Verify "+channel,exact:true}).click();
  if(channel==="email")await page.getByText("Step 2 of 2: phone",{exact:true}).waitFor();
  else await page.getByText("Email and phone verification passed.",{exact:true}).waitFor();
 }
 await page.goto(url+"/worker/login");
 await page.getByLabel("Email address").fill(person.email);
 await page.getByLabel("Password").fill(person.password);
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL("**/worker/dashboard",{timeout:20000});
}
async function principal(db,email){
 const r=(await db.query("SELECT a.account_id,a.email_normalized,a.account_status,a.email_verified_at,a.phone_verified_at,s.session_id,s.last_seen_at,s.expires_at FROM auth_accounts a JOIN auth_sessions s ON s.account_id=a.account_id WHERE a.email_normalized=$1 AND s.active_role='worker' AND s.revoked_at IS NULL ORDER BY s.created_at DESC LIMIT 1",[email])).rows[0];
 assert.ok(r&&r.email_verified_at&&r.phone_verified_at);
 assert.equal(r.account_status,"active");
 return {accountId:r.account_id,sessionId:r.session_id,activeRole:"worker",accountStatus:"active",
  email:r.email_normalized,tenantMembership:null,displayName:"Registered Worker",
  lastSeenAt:new Date(r.last_seen_at).toISOString(),expiresAt:new Date(r.expires_at).toISOString()};
}
test("two real Worker registrations verify email+phone OTP and cannot duplicate Worker ID or apply for exams",{timeout:240000},async()=>{
 const base=await reportCompanyFixture();
 await base.database.close();
 base.environment.HSE_ENABLE_AUTH_SANDBOX="true";
 base.environment.HSE_AUTH_SANDBOX_ACCESS_KEY=sandboxKey;
 const localPort=await port(),url="http://127.0.0.1:"+localPort,errors=[];
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const a=await(await browser.newContext()).newPage();
  const b=await(await browser.newContext()).newPage();
  const inbox=await(await browser.newContext()).newPage();
  for(const p of [a,b,inbox]){
   p.on("pageerror",e=>errors.push(e.message));
   p.on("response",r=>{if(r.status()>=500)errors.push(r.status()+" "+new URL(r.url()).pathname);});
  }
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(localPort)],
   probeUrl:url+"/worker/register",projectRoot:process.cwd(),environment:base.environment,
   probe:async()=>{
    await register(a,inbox,url,workers[0]);
    await register(b,inbox,url,workers[1]);
    await a.goto(url+"/worker/dashboard");
    await b.goto(url+"/worker/dashboard");
    assert.equal(new URL(a.url()).pathname,"/worker/dashboard");
    assert.equal(new URL(b.url()).pathname,"/worker/dashboard");
   }
  });
  const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:base.environment.HSE_PGLITE_DATA_DIR});
  let id,firstAccount,secondAccount,checkId;
  try{
   const one=await principal(db,workers[0].email),two=await principal(db,workers[1].email);
   firstAccount=one.accountId;secondAccount=two.accountId;
   assert.notEqual(firstAccount,secondAccount);
   const registrations=(await db.query("SELECT account_id,current_step FROM auth_registration_flows WHERE account_id=ANY($1::text[])",[[firstAccount,secondAccount]])).rows;
   assert.equal(registrations.length,2);
   assert.ok(registrations.every(x=>x.current_step==="complete"));
   const first=await prepareSubmittedWorker(db,"otp-first",{workerPrincipal:one,draft:legal,documentNumber:"OTP-DUP-4057",storage:base.storage});
   await advanceThroughAutomatedChecks(first);
   await markVerified(db,first.submitted.identity.identityId);
   assert.equal((await first.eligibilityService.evaluate(first.submitted.identity.identityId)).checkStatus,"clear");
   id=(await first.eligibilityService.issuePermanentWorkerId(first.submitted.identity.identityId)).permanentWorkerId;
   const matching=await prepareSubmittedWorker(db,"otp-second",{workerPrincipal:two,draft:legal,documentNumber:"OTPDUP4057",storage:base.storage});
   await advanceThroughAutomatedChecks(matching);
   await markVerified(db,matching.submitted.identity.identityId);
   const duplicate=await matching.eligibilityService.evaluate(matching.submitted.identity.identityId);
   assert.equal(duplicate.checkStatus,"review_required");
   checkId=duplicate.checkId;
   assert.ok((await db.query("SELECT signal_type FROM worker_identity_duplicate_signals WHERE check_id=$1",[checkId])).rows.some(x=>x.signal_type==="identity_document_exact"));
   await assert.rejects(matching.eligibilityService.issuePermanentWorkerId(matching.submitted.identity.identityId),
    e=>e?.name==="WorkerIdentityWorkerIdBlockedError");
   const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
   const app=new WorkerAssessmentApplicationService(db);
   assert.deepEqual(await app.listOfferings(two),[]);
   await assert.rejects(app.applyWorkerPay(two,"catalogue_version_"+"X".repeat(24)),
    e=>e?.name==="WorkerAssessmentApplicationConflictError"&&/permanent Worker ID/.test(e.message));
   assert.equal((await db.query("SELECT COUNT(*)::int n FROM worker_identity_worker_ids WHERE worker_account_id=ANY($1::text[])",[[firstAccount,secondAccount]])).rows[0].n,1);
  }finally{await db.close();}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(localPort)],
   probeUrl:url+"/worker/login",projectRoot:process.cwd(),environment:base.environment,
   probe:async()=>{
    await a.goto(url+"/worker/identity");
    await a.getByText(id,{exact:true}).waitFor();
    await b.goto(url+"/worker/identity");
    await b.getByText("Duplicate/recovery eligibility requires authorized review.",{exact:true}).waitFor();
    await b.getByText("Not issued",{exact:true}).waitFor();
    assert.equal((await b.content()).includes(id),false);
    await b.goto(url+"/worker/assessment-applications");
    await b.getByRole("heading",{name:"Apply and fund an assessment"}).waitFor();
    assert.equal(await b.getByRole("button",{name:"Apply — worker pays",exact:true}).count(),0);
   }
  });
  const proof=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:base.environment.HSE_PGLITE_DATA_DIR});
  try{
   assert.equal((await proof.query("SELECT COUNT(*)::int n FROM worker_assessment_applications WHERE worker_account_id=$1",[secondAccount])).rows[0].n,0);
   assert.equal((await proof.query("SELECT COUNT(*)::int n FROM assessment_attempts WHERE worker_account_id=$1",[secondAccount])).rows[0].n,0);
   assert.equal((await proof.query("SELECT COUNT(*)::int n FROM worker_identity_duplicate_checks WHERE check_id=$1",[checkId])).rows[0].n,1);
  }finally{await proof.close();}
  assert.deepEqual(errors,[]);
  console.log("ACTUAL_TWO_WORKER_OTP_SIGNUPS both email+phone real sandbox deliveries consumed; independent signins, matching legal identity blocked second permanent ID and assessment application");
 }finally{await browser?.close();await base.cleanup();}
});
