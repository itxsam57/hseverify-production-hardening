import assert from "node:assert/strict";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {assessmentFundingFixture} from "../helpers/assessment-funding-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const {AssessmentFormGenerationService,hasUnseenAssessmentCapacity}=loadWorkerRegistrationTs("src/lib/assessment-generation/assessment-form-generation-service.ts");
const sandboxKey="worker-exposure-otp-recovery-local-2026";
const newPassword="RecoveredExposure!Password2026";
async function port(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const a=server.address();server.close(e=>e?reject(e):!a||typeof a==="string"?reject(new Error("No free port")):resolve(a.port));});});}
async function login(page,url,email,password){
 await page.goto(url+"/worker/login");
 await page.getByLabel("Email address").fill(email);
 await page.getByLabel("Password").fill(password);
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL("**/worker/dashboard",{timeout:20000});
}
test("real Worker password recovery retains permanent Worker ID, previous question family, and blocks retake",{timeout:240000},async()=>{
 const fixture=await assessmentFundingFixture({startingCreditUnits:0});
 fixture.environment.HSE_ENABLE_AUTH_SANDBOX="true";
 fixture.environment.HSE_AUTH_SANDBOX_ACCESS_KEY=sandboxKey;
 const url="http://127.0.0.1:"+(await port());
 let expectedId,formId,family,frameworkId,blueprintVersionId,browser;
 const errors=[];
 try{
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const apps=new WorkerAssessmentApplicationService(db);
   const request=await apps.applyWorkerPay(fixture.worker,fixture.fundingInput.catalogueVersionId);
   const paid=await apps.confirmSandboxWorkerPayment(fixture.worker,request.applicationId);
   const selected=(await db.query("SELECT framework_id,blueprint_version_id FROM assessment_catalogue_versions WHERE catalogue_version_id=$1",[fixture.fundingInput.catalogueVersionId])).rows[0];
   frameworkId=selected.framework_id;blueprintVersionId=selected.blueprint_version_id;
   const form=await new AssessmentFormGenerationService(db).generateForCase(fixture.worker,{caseId:paid.caseId,blueprintVersionId});
   formId=form.formId;
   const exposure=(await db.query("SELECT permanent_worker_id,exposure_family_reference FROM generated_assessment_form_items WHERE form_id=$1",[formId])).rows;
   assert.equal(exposure.length,1);
   expectedId=exposure[0].permanent_worker_id;family=exposure[0].exposure_family_reference;
   assert.match(expectedId,/^worker_id_/);
   assert.equal(await hasUnseenAssessmentCapacity(db,{workerAccountId:fixture.worker.accountId,blueprintVersionId,frameworkId}),false);
  }finally{await db.close();}
  browser=await chromium.launch({headless:true});
  const oldContext=await browser.newContext(),resetContext=await browser.newContext();
  const old=await oldContext.newPage(),reset=await resetContext.newPage(),inbox=await resetContext.newPage();
  for(const p of [old,reset,inbox]){
   p.on("pageerror",e=>errors.push(e.message));
   p.on("response",r=>{if(r.status()>=500)errors.push(r.status()+" "+new URL(r.url()).pathname);});
  }
  const identity=fixture.credentials.worker;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(url).port],probeUrl:url+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   await login(old,url,identity.email,identity.password);
   await old.goto(url+"/worker/dashboard");
   await old.getByRole("heading",{name:/Worker/i}).first().waitFor();
   await reset.goto(url+"/auth/recover?portal=worker");
   await reset.getByLabel("Account email").fill(identity.email);
   await reset.getByRole("button",{name:"Continue securely"}).click();
   await reset.waitForURL("**/auth/recover/verify?portal=worker");
   await inbox.goto(url+"/worker/register/sandbox");
   await inbox.getByLabel("Delivery channel").selectOption("email");
   await inbox.getByLabel("Delivery destination").fill(identity.email);
   await inbox.getByLabel("Sandbox access key").fill(sandboxKey);
   await inbox.getByRole("button",{name:"Open latest sandbox delivery"}).click();
   const status=inbox.getByRole("status",{name:"Latest sandbox verification code"});
   await status.waitFor();
   const code=(await status.locator("strong").innerText()).trim();
   await reset.getByLabel("Recovery code",{exact:true}).fill(code);
   await reset.getByLabel("New password",{exact:true}).fill(newPassword);
   await reset.getByLabel("Confirm new password",{exact:true}).fill(newPassword);
   await reset.getByRole("button",{name:"Reset password and revoke sessions"}).click();
   await reset.waitForURL("**/worker/login?reason=password-reset");
   await old.goto(url+"/worker/identity");
   assert.equal(new URL(old.url()).pathname,"/worker/login","Password recovery must revoke the prior authenticated session.");
   await login(reset,url,identity.email,newPassword);
   await reset.goto(url+"/worker/dashboard");
   await reset.getByRole("heading",{name:/Worker/i}).first().waitFor();
   await reset.goto(url+"/worker/assessment-applications");
   await reset.getByRole("heading",{name:"Apply and fund an assessment"}).waitFor();
   assert.equal(await reset.getByRole("button",{name:"Apply — worker pays",exact:true}).count(),0,
    "Worker must not be able to reapply for already exhausted question family after password reset.");
  }});
  const proof=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const account=(await proof.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[identity.email])).rows[0].account_id;
   assert.equal(account,fixture.worker.accountId);
   const ids=(await proof.query("SELECT permanent_worker_id,worker_account_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",[account])).rows;
   assert.deepEqual(ids,[{permanent_worker_id:expectedId,worker_account_id:account}]);
   const rows=(await proof.query("SELECT permanent_worker_id,exposure_family_reference FROM generated_assessment_form_items WHERE form_id=$1",[formId])).rows;
   assert.deepEqual(rows,[{permanent_worker_id:expectedId,exposure_family_reference:family}]);
   assert.equal(await hasUnseenAssessmentCapacity(proof,{workerAccountId:account,blueprintVersionId,frameworkId}),false,
    "Password reset must never restore already-exposed question capacity.");
   const sessionRows=(await proof.query("SELECT revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1",[account])).rows;
   assert.ok(sessionRows.some(s=>s.revoked_at&&s.revocation_reason==="password_reset"));
   assert.ok(sessionRows.some(s=>s.revoked_at===null));
   assert.equal((await proof.query("SELECT COUNT(*)::int n FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.password_reset.completed'",[account])).rows[0].n,1);
  }finally{await proof.close();}
  assert.deepEqual(errors,[]);
  console.log("WORKER_RECOVERY_EXPOSURE_BROWSER real password reset email OTP/revocation/new sign-in retained same permanent Worker ID and immutable previous Exposure Family, retake capacity not restored");
 }finally{await browser?.close();await fixture.cleanup();}
});
