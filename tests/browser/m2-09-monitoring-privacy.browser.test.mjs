import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { integrityAssessmentFixture } from "../helpers/integrity-assessment-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";

const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){
 let bits="",bytes=[];
 for(const char of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(char).toString(2).padStart(5,"0");
 for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
 return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
function freePort(){
 return new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
   const address=server.address();server.close(error=>error?reject(error):resolve(address.port));
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

test("Worker monitoring event strips private accommodation disclosures before Verifier review",{timeout:180000},async()=>{
 const x=await integrityAssessmentFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const {PrivacyOperationsService}=loadWorkerRegistrationTs("src/lib/privacy/privacy-operations-service.ts");
 const {PrivacyOperationsRepository}=loadWorkerRegistrationTs("src/lib/privacy/privacy-operations-repository.ts");
 const privacy=new PrivacyOperationsService(new PrivacyOperationsRepository(Promise.resolve(x.database)));
 await privacy.accommodation({id:"browser_integrity_private",tenantId:null,workerId:x.worker.accountId,type:"PRIVATE_MEDICAL_BROWSER_MARKER"});
 await privacy.reviewAccommodation({accommodationId:"browser_integrity_private",reviewerAccountId:x.credentials.admin.accountId,decision:"APPROVED",reason:"PRIVATE_ADMIN_BROWSER_MARKER",caseId:x.sourceCase.case_id,adjustment:{screenReader:true,timeMultiplier:1.5},now:new Date()});
 await x.releaseDatabase();
 let capturedEventId;
 try{
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:x.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const worker=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const verifier=await(await browser.newContext()).newPage();
    await login(worker,baseUrl,x.credentials.worker,"worker");
    await worker.goto(baseUrl+"/worker/assessments/"+x.attemptId);
    await worker.getByLabel("Stop and assess",{exact:true}).waitFor();
    const submission=await worker.evaluate(async id=>{
     const response=await fetch("/api/worker/assessments/"+encodeURIComponent(id)+"/integrity",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({type:"COPY_PASTE_DETECTED",details:{
       operation:"paste",diagnosis:"PRIVATE_DIAGNOSIS_BROWSER_MARKER",
       reason:"PRIVATE_MEDICAL_BROWSER_MARKER",accommodation:"PRIVATE_ADMIN_BROWSER_MARKER"
      }})
     });
     return {status:response.status,data:await response.json()};
    },x.attemptId);
    assert.equal(submission.status,201,JSON.stringify(submission));
    capturedEventId=submission.data.event.eventId;
    assert.equal(submission.data.event.type,"COPY_PASTE_DETECTED");
    assert.equal(submission.data.event.classification,"RED");
    await worker.getByLabel("Stop and assess",{exact:true}).check();
    await worker.getByRole("button",{name:"Submit assessment",exact:true}).click();
    await worker.getByText("Submission received. You may leave this page safely.",{exact:true}).waitFor({timeout:20000});
    await login(verifier,baseUrl,x.credentials.verifier,"verifier");
    const denied=await verifier.evaluate(async id=>{
     const res=await fetch("/api/worker/assessments/"+encodeURIComponent(id)+"/integrity",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"COPY_PASTE_DETECTED",details:{operation:"paste"}})});
     return res.status;
    },x.attemptId);
    assert.ok([400,401,403,404].includes(denied),"Verifier must not impersonate Worker monitoring sender: "+denied);
    // Existing API guard converts role redirects to a generic 400. It must never accept or persist the event.
    await verifier.goto(baseUrl+"/verifier/reviews/scoring");
    const queue=verifier.getByRole("region",{name:/Integrity review/});
    await queue.getByRole("list",{name:"Retained integrity signals"}).waitFor();
    const visible=await queue.innerText();
    assert.match(visible,/COPY_PASTE_DETECTED/);
    for(const marker of ["PRIVATE_DIAGNOSIS_BROWSER_MARKER","PRIVATE_MEDICAL_BROWSER_MARKER","PRIVATE_ADMIN_BROWSER_MARKER"])assert.ok(!visible.includes(marker));
   }finally{await browser.close();}
  }});
  const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:x.environment.HSE_PGLITE_DATA_DIR});
  try{
   const row=(await db.query("SELECT event_type,classification,details FROM integrity_capture_events WHERE event_id=$1",[capturedEventId])).rows[0];
   assert.equal(row.event_type,"COPY_PASTE_DETECTED");assert.equal(row.classification,"RED");
   assert.deepEqual(typeof row.details==="string"?JSON.parse(row.details):row.details,{operation:"paste"});
   const privateRow=(await db.query("SELECT accommodation_type,review_reason FROM accessibility_accommodations WHERE accommodation_id='browser_integrity_private'")).rows[0];
   assert.match(privateRow.accommodation_type,/PRIVATE_MEDICAL_BROWSER_MARKER/);
   const attempts=(await db.query("SELECT count(*)::integer AS n FROM integrity_capture_events WHERE attempt_id=$1 AND event_type='COPY_PASTE_DETECTED'",[x.attemptId])).rows[0];
   assert.equal(attempts.n,1,"Verifier's forged signal must never create a second retained event.");
  }finally{await db.close();}
  console.log("ACTUAL_M20905_BROWSER 390px Worker approved accommodation + hostile monitoring detail -> exact sanitized persisted signal -> Verifier concern, forged Verifier POST denied");
 }finally{await x.cleanup();}
});
