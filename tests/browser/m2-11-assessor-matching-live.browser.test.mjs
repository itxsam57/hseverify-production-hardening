import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {assessorInterviewSearchFixture} from "../helpers/assessor-interview-search-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
const {InterviewSchedulingService}=loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){
 let bits="",bytes=[];
 for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(c).toString(2).padStart(5,"0");
 for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
 return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);
 server.listen(0,"127.0.0.1",()=>{const a=server.address();server.close(error=>error?reject(error):resolve(a.port));});});}
async function login(page,base,credential,role){
 await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
 await page.getByLabel("Email address").fill(credential.email);
 await page.getByLabel("Password").fill(credential.password);
 if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});
}
test("M2.11.01 real Admin profile and automatic match reject mismatched language and filled workload; corrected profile assigns Assessor",{timeout:240000},async()=>{
 const f=await assessorInterviewSearchFixture();
 let stage="setup";let request;
 try{
  const db=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
  try{
   request=await new InterviewSchedulingService(db).requestAdditionalInterview({
    tenantId:f.credentials.company.tenantId,caseId:f.requests.Alpha.caseId,
    workerAccountId:f.credentials.worker.accountId,requestedAt:new Date().toISOString()
   });
   await db.query("UPDATE interview_requests SET trade_scope='Electrical',qualification_scope='Level3',language='English',jurisdiction='GLOBAL',risk_level='HIGH' WHERE interview_request_id=$1",[request.interviewRequestId]);
  }finally{await db.close();}
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/admin/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const admin=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const assessor=await(await browser.newContext()).newPage();
    await login(admin,base,f.credentials.admin,"admin");
    stage="profile form";
    async function profile(language,capacity){
     await admin.goto(base+"/admin/assessor-matching");
     const form=admin.locator("form").filter({has:admin.getByRole("button",{name:"Save matching profile",exact:true})});
     await form.locator('select[name="assessorAccountId"]').selectOption(f.credentials.assessor.accountId);
     await form.getByLabel("Trade scopes").fill("Electrical");
     await form.getByLabel("Qualification scopes").fill("Level3");
     await form.getByLabel("Languages").fill(language);
     await form.getByLabel("Jurisdictions").fill("GLOBAL");
     await form.getByLabel("Risk levels").fill("HIGH");
     await form.getByLabel("Maximum active interviews").fill(String(capacity));
     await form.getByRole("button",{name:"Save matching profile"}).click();
     await admin.getByRole("status").filter({hasText:"Assessor matching profile saved."}).waitFor({timeout:20000});
    }
    async function runMatch(outcome){
     await admin.goto(base+"/admin/assessor-matching");
     const card=admin.locator("article").filter({hasText:request.interviewRequestId});
     await card.getByRole("button",{name:"Run automatic match"}).click();
     await admin.getByRole("status").filter({hasText:outcome}).waitFor({timeout:20000});
    }
    await profile("Urdu",1);
    stage="language mismatch";
    await runMatch("No eligible Assessor matched.");
    await profile("English",1);
    stage="capacity mismatch";
    await runMatch("No eligible Assessor matched.");
    await profile("English",3);
    stage="eligible match";
    await runMatch("Interview assigned to the highest-ranked eligible Assessor.");
    await login(assessor,base,f.credentials.assessor,"assessor");
    await assessor.goto(base+"/assessor/interviews");
    await assessor.locator('a[href="/assessor/interviews/'+request.interviewRequestId+'"]').waitFor({timeout:20000});
    const other=await admin.locator("article").filter({hasText:request.interviewRequestId}).count();
    assert.equal(other,0,"Assigned request leaves pending Admin queue");
   }finally{await browser.close();}
  }});
  const verifyDb=await PGlite.create(f.environment.HSE_PGLITE_DATA_DIR);
  try{
   const result=(await verifyDb.query("SELECT status,assessor_account_id FROM interview_requests WHERE interview_request_id=$1",[request.interviewRequestId])).rows[0];
   assert.deepEqual(result,{status:"ASSIGNED",assessor_account_id:f.credentials.assessor.accountId});
   const rows=(await verifyDb.query("SELECT eligibility_json,selected,rationale,score FROM interview_assignment_decisions WHERE interview_request_id=$1",[request.interviewRequestId])).rows;
   assert.equal(rows.filter(r=>r.selected).length,1);
   assert.ok(rows.find(r=>r.selected).score>0);
   assert.ok(rows.find(r=>r.selected).eligibility_json.calibration);
   assert.ok(rows.find(r=>r.selected).eligibility_json.workload);
   assert.ok(rows.find(r=>r.selected).eligibility_json.language);
  }finally{await verifyDb.close();}
  console.log("ACTUAL_M21101_BROWSER 390px Admin mismatched language no eligible; overloaded no eligible; corrected match and separate signed-in Assessor receives assigned request.");
 }catch(e){console.error("M21101_STAGE "+stage);throw e;}finally{await f.cleanup();}
});
