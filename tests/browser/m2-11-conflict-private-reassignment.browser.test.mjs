import assert from "node:assert/strict";
import {createHmac,createHash,randomUUID} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewAssignmentService}=loadWorkerRegistrationTs("src/lib/interview/interview-assignment-service.ts");
const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){let bits="",bytes=[];for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(c).toString(2).padStart(5,"0");for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");}
function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));});});}
async function login(page,base,credential,role){await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});await page.getByLabel("Email address").fill(credential.email);await page.getByLabel("Password").fill(credential.password);if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});}
test("M2.11.04 real Assessor conflict form releases original to separately signed-in successor without leaking notes to Worker or Company",{timeout:240000},async()=>{
 const f=await assessorInterviewSearchFixture(),request=f.requests.Alpha;
 const secondId="conflict_second_"+randomUUID().replaceAll("-","").slice(0,16);
 const secondEmail="assessor.second."+randomUUID()+"@example.test";
 const second={...f.credentials.assessor,accountId:secondId,email:secondEmail};
 const privateReason="PRIVATE_CONFLICT_MARKER I am directly related to this Worker and cannot conduct a fair interview.";
 let stage="fixture";
 try{
  const db=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
  try{
   const now=new Date().toISOString(),sessionId="conflict-browser-admin-"+randomUUID();
   await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:f.credentials.admin.accountId,activeRole:"admin",tokenHash:createHash("sha256").update(sessionId).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+sessionId).digest("hex"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
   const admin={accountId:f.credentials.admin.accountId,sessionId,activeRole:"admin",accountStatus:"active",tenantMembership:null};
   await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) SELECT $1,$2,'Second Interview Assessor','active',password_hash,CURRENT_TIMESTAMP,password_set_at,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM auth_accounts WHERE account_id=$3",[secondId,secondEmail,f.credentials.assessor.accountId]);
   await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'assessor')",[secondId]);
   await db.query("INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,created_at,activated_at) SELECT $1,$2,factor_type,encrypted_secret,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM auth_mfa_factors WHERE account_id=$3 AND factor_status='active'",["conflict_mfa_"+randomUUID(),secondId,f.credentials.assessor.accountId]);
   const rev=(await db.query("SELECT revisions.framework_version_id,revisions.effective_from FROM assurance_framework_revisions revisions JOIN assurance_frameworks frameworks USING(framework_id) WHERE frameworks.framework_reference='SEARCH-WORKER' ORDER BY revisions.version_no DESC LIMIT 1")).rows[0];
   await new StaffCalibrationService(Promise.resolve(db)).record(admin,{accountId:secondId,role:"assessor",frameworkReference:"SEARCH-WORKER",frameworkVersionId:rev.framework_version_id,status:"CURRENT",validFrom:new Date(rev.effective_from),validUntil:new Date("2099-01-01"),note:"Second Assessor calibrated against exact published version."});
   const matching=new InterviewAssignmentService(db),profile={tradeScopes:["*"],qualificationScopes:["*"],languages:["English"],jurisdictions:["GLOBAL"],riskLevels:["STANDARD"],availability:{},maxActiveInterviews:8,status:"ACTIVE"};
   await matching.upsertProfile(admin,{assessorAccountId:f.credentials.assessor.accountId,...profile});
   await matching.upsertProfile(admin,{assessorAccountId:secondId,...profile});
  }finally{await db.close();}
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/assessor/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const first=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const successor=await(await browser.newContext()).newPage();
    const worker=await(await browser.newContext()).newPage();
    const admin=await(await browser.newContext()).newPage();
    const company=await(await browser.newContext()).newPage();
    await login(first,base,f.credentials.assessor,"assessor");
    await login(successor,base,second,"assessor");
    await login(worker,base,f.credentials.worker,"worker");
    await login(admin,base,f.credentials.admin,"admin");
    await login(company,base,f.credentials.company,"company");
    stage="first assessor assigned";
    await first.goto(base+"/assessor/interviews");
    const firstRow=first.locator("tbody tr").filter({has:first.locator('a[href="/assessor/interviews/'+request.interviewRequestId+'"]')});
    await firstRow.getByText("Declare conflict").click();
    await firstRow.getByLabel("Conflict reason").fill(privateReason);
    stage="submit conflict";
    await firstRow.getByRole("button",{name:"Release and re-match"}).click();
    await firstRow.waitFor({state:"detached",timeout:20000});
    stage="successor receives";
    await successor.goto(base+"/assessor/interviews");
    await successor.locator('a[href="/assessor/interviews/'+request.interviewRequestId+'"]').waitFor({timeout:20000});
    assert.ok(!(await successor.locator("body").innerText()).includes(privateReason));
    stage="worker privacy";
    await worker.goto(base+"/worker/interviews/"+request.interviewRequestId);
    assert.ok(!(await worker.locator("body").innerText()).includes(privateReason));
    stage="company privacy";
    await company.goto(base+"/company/assurance-orders");
    assert.ok(!(await company.locator("body").innerText()).includes(privateReason));
    stage="admin state";
    await admin.goto(base+"/admin/assessor-matching");
    assert.equal(await admin.locator("article").filter({hasText:request.interviewRequestId}).count(),0,"Reassigned case no longer pending");
    stage="first denied";
    await first.goto(base+"/assessor/interviews/"+request.interviewRequestId);
    assert.ok(!(await first.locator("body").innerText()).includes(privateReason));
   }finally{await browser.close();}
  }});
  const db2=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
  try{
   const rows=(await db2.query("SELECT status,assessor_account_id,reschedule_reason FROM interview_requests WHERE interview_request_id=$1",[request.interviewRequestId])).rows[0];
   assert.equal(rows.assessor_account_id,secondId);assert.equal(rows.status,"ASSIGNED");assert.ok(!JSON.stringify(rows).includes(privateReason));
   const conflict=(await db2.query("SELECT reason,assessor_account_id,worker_account_id FROM interview_assignment_conflicts WHERE worker_account_id=$1",[f.credentials.worker.accountId])).rows;
   assert.equal(conflict.length,1);assert.equal(conflict[0].reason,privateReason);assert.equal(conflict[0].assessor_account_id,f.credentials.assessor.accountId);
   const check=(await db2.query("SELECT selected,assessor_account_id,eligibility_json FROM interview_assignment_decisions WHERE interview_request_id=$1",[request.interviewRequestId])).rows;
   assert.equal(check.filter(x=>x.selected).length,1);assert.equal(check.find(x=>x.selected).assessor_account_id,secondId);assert.ok(check.find(x=>x.selected).eligibility_json.conflictFree);
  }finally{await db2.close();}
  console.log("ACTUAL_M21104_BROWSER real 5-role auth + conflict submission, 390px Assessor, successor assignment, Worker Company privacy, immutable conflict record.");
 }catch(error){console.error("M21104_STAGE "+stage);throw error;}finally{await f.cleanup();}
});
