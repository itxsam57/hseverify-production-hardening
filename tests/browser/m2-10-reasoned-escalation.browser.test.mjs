import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {reportCompanyFixture} from "../helpers/report-company-fixture.mjs";
import {authorizeReviewFixture} from "../helpers/evidence-review-calibration-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret){
 let bits="",bytes=[];
 for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=B32.indexOf(c).toString(2).padStart(5,"0");
 for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
 return String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
}
function freePort(){return new Promise((resolve,reject)=>{
 const server=createServer();server.once("error",reject);
 server.listen(0,"127.0.0.1",()=>{const a=server.address();server.close(error=>error?reject(error):resolve(a.port));});
});}
async function login(page,base,cred,role){
 await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
 await page.getByLabel("Email address").fill(cred.email);
 await page.getByLabel("Password").fill(cred.password);
 if(cred.totpSecret)await page.getByLabel("Authenticator code").fill(totp(cred.totpSecret));
 await page.getByRole("button",{name:"Sign in",exact:true}).click();
 await page.waitForURL("**/"+role+"/dashboard",{timeout:20000});
}
async function claim(page,base,taskId){
 await page.goto(base+"/verifier/reviews/"+taskId);
 await page.getByRole("button",{name:"Claim review",exact:true}).click();
 await page.getByText("ASSIGNED",{exact:true}).waitFor({timeout:20000});
}
async function saveNotes(page,notes){
 await page.getByLabel("Private draft notes",{exact:true}).fill(notes);
 await page.getByRole("button",{name:"Save draft notes",exact:true}).click();
 await page.reload({waitUntil:"domcontentloaded"});
 assert.equal(await page.getByLabel("Private draft notes",{exact:true}).inputValue(),notes);
 assert.equal(await page.locator('input[name="draftRevision"]').inputValue(),"1");
}
async function unable(page,reason){
 await page.getByLabel("Unable to verify reason",{exact:true}).fill(reason);
 await page.getByLabel("Attempted verification methods",{exact:true}).fill("Contacted issuing authority and checked the public registry.");
 await page.getByLabel("Verification limitations",{exact:true}).fill("Issuer has not responded and historical coverage is incomplete.");
 await page.getByRole("button",{name:"Record unable to verify",exact:true}).click();
 await page.getByRole("heading",{name:"UNABLE TO VERIFY",exact:true}).waitFor({timeout:20000});
}
test("M2.10.07 two live source tasks: Unable/attempted methods, private draft, Admin escalation, independent return and auditable resolution",{timeout:240000},async()=>{
 const f=await reportCompanyFixture(),secondId="audit_second_verifier_"+randomUUID().replaceAll("-","").slice(0,16);
 const secondEmail="m21007.second."+randomUUID()+"@example.test";
 const second={...f.credentials.verifier,accountId:secondId,email:secondEmail};
 const firstNote="PRIVATE_REVIEWER_NOTE_MARKER Original Verifier issuer follow-up remains pending.";
 const secondNote="PRIVATE_ESCALATION_NOTE_MARKER Original Verifier dispute escalation for Admin.";
 let stage="setup";
 try{
  const db=f.database;
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,email_verified_at,password_hash,password_set_at) SELECT $1,$2,'Independent Followup Verifier','active',CURRENT_TIMESTAMP,password_hash,password_set_at FROM auth_accounts WHERE account_id=$3",[secondId,secondEmail,f.credentials.verifier.accountId]);
  await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[secondId]);
  await db.query("INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,created_at,activated_at) SELECT $1,$2,factor_type,encrypted_secret,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM auth_mfa_factors WHERE account_id=$3 AND factor_status='active'",["m21007_mfa_"+randomUUID(),secondId,f.credentials.verifier.accountId]);
  const service=new EvidenceReviewService(db),tasks=[];
  for(const suffix of ["unable","escalated"]){
   const recordId="m21007_record_"+suffix,versionId="m21007_version_"+suffix;
   await db.query("INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES($1,$2,'qualification','active',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",[recordId,f.worker.accountId]);
   await db.query("INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,submitted_at,created_at,updated_at) VALUES($1,$2,1,1,'submitted',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",[versionId,recordId]);
   await db.query("UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1",[recordId,versionId]);
   const queued=await service.queueIndependentWorkerEvidence(f.worker,recordId);
   await authorizeReviewFixture(db,{taskId:queued.taskId,verifiers:[{accountId:f.credentials.verifier.accountId},{accountId:secondId}]});
   tasks.push(queued);
  }
  const [taskUnable,taskEscalated]=tasks;
  await db.close();
  const port=await freePort(),base="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/verifier/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const verifier=await(await browser.newContext({viewport:{width:390,height:844}})).newPage();
    const admin=await(await browser.newContext()).newPage();
    const secondVerifier=await(await browser.newContext()).newPage();
    const worker=await(await browser.newContext()).newPage();
    await login(verifier,base,f.credentials.verifier,"verifier");
    await login(admin,base,f.credentials.admin,"admin");
    await login(worker,base,f.credentials.worker,"worker");
    stage="unable claim";
    await claim(verifier,base,taskUnable.taskId);
    await saveNotes(verifier,firstNote);
    await unable(verifier,"Historical issuer record remains unverified; not an allegation of fraud.");
    await verifier.getByText(firstNote,{exact:true}).waitFor({timeout:20000});
    await verifier.getByText(/Attempted methods: Contacted issuing authority/).waitFor();
    await admin.goto(base+"/admin/operations/review-escalations");
    assert.equal(await admin.locator("article").filter({hasText:taskUnable.taskId}).count(),0,"Unable-to-verify is NOT an Admin escalation");
    stage="escalation claim";
    await claim(verifier,base,taskEscalated.taskId);
    await saveNotes(verifier,secondNote);
    await verifier.getByLabel("Escalation reason",{exact:true}).fill("A contradictory issuer reply needs independent Admin evaluation.");
    await verifier.getByRole("button",{name:"Escalate review",exact:true}).click();
    await verifier.getByRole("heading",{name:"ESCALATED",exact:true}).waitFor({timeout:20000});
    assert.equal(await verifier.getByRole("button",{name:"Claim review"}).count(),0);
    stage="Admin return";
    await admin.goto(base+"/admin/operations/review-escalations");
    const article=admin.getByRole("article",{name:"Escalation "+taskEscalated.taskId});
    await article.getByText(/A contradictory issuer reply/).waitFor({timeout:20000});
    assert.ok(!(await article.innerText()).includes(secondNote),"Private draft leaked to Admin.");
    await article.getByLabel("Review and return reason",{exact:true}).fill("Admin reviewed issuer conflict: obtain a fresh independent review.");
    await article.getByRole("button",{name:"Return to Verifier queue"}).click();
    await admin.getByRole("status").filter({hasText:"Escalation reviewed and returned"}).waitFor({timeout:20000});
    stage="independent reviewer";
    await login(secondVerifier,base,second,"verifier");
    await claim(secondVerifier,base,taskEscalated.taskId);
    const text=await secondVerifier.locator("body").innerText();
    assert.match(text,/RETURNED TO QUEUE/);
    assert.ok(!text.includes(secondNote),"Original private reviewer draft leaked to independent reviewer.");
    assert.equal(await secondVerifier.getByLabel("Private draft notes",{exact:true}).inputValue(),"");
    await unable(secondVerifier,"Second calibrated Verifier independently could not confirm the disputed issuer record.");
    stage="worker safety";
    await worker.goto(base+"/worker/evidence");
    assert.ok(!(await worker.locator("body").innerText()).includes(firstNote),"Private reviewer note leaked into Worker evidence.");
   }finally{await browser.close();}
  }});
  const verify=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});
  try{
   const history=(await verify.query("SELECT task_id,revision,outcome,reason,attempted_methods,limitations,destination,actor_account_id,actor_role FROM evidence_review_resolution_events WHERE task_id=ANY($1::text[]) ORDER BY task_id,revision",[[taskUnable.taskId,taskEscalated.taskId]])).rows;
   assert.equal(history.length,4);
   assert.deepEqual(history.filter(x=>x.task_id===taskEscalated.taskId).map(x=>x.outcome),["ESCALATED","RETURNED_TO_QUEUE","UNABLE_TO_VERIFY"]);
   assert.equal(history.find(x=>x.task_id===taskEscalated.taskId&&x.outcome==="RETURNED_TO_QUEUE").actor_account_id,f.credentials.admin.accountId);
   assert.equal(history.find(x=>x.task_id===taskEscalated.taskId&&x.outcome==="UNABLE_TO_VERIFY").actor_account_id,secondId);
   assert.equal(history.find(x=>x.task_id===taskUnable.taskId).outcome,"UNABLE_TO_VERIFY");
   assert.match(history.find(x=>x.task_id===taskUnable.taskId).attempted_methods,/Contacted issuing authority/);
   assert.match(history.find(x=>x.task_id===taskUnable.taskId).limitations,/Issuer has not responded/);
   assert.equal((await verify.query("SELECT count(*)::integer AS n FROM evidence_review_decisions WHERE task_id=ANY($1::text[])",[[taskUnable.taskId,taskEscalated.taskId]])).rows[0].n,0);
   for(const t of tasks){assert.equal((await verify.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[t.taskId])).rows[0].task_status,"UNABLE_TO_VERIFY");}
   const drafts=(await verify.query("SELECT verifier_account_id,notes FROM evidence_review_draft_revisions WHERE task_id=ANY($1::text[])",[[taskUnable.taskId,taskEscalated.taskId]])).rows;
   assert.ok(drafts.some(x=>x.verifier_account_id===f.credentials.verifier.accountId&&x.notes===firstNote));
   assert.ok(drafts.some(x=>x.verifier_account_id===f.credentials.verifier.accountId&&x.notes===secondNote));
   assert.ok(history.every(x=>!JSON.stringify(x).includes("PRIVATE_")));
   await assert.rejects(verify.query("UPDATE evidence_review_resolution_events SET reason='tampered' WHERE task_id=$1",[taskEscalated.taskId]),/immutable|append.only/i);
   await assert.rejects(verify.query("DELETE FROM evidence_review_draft_revisions WHERE task_id=$1",[taskUnable.taskId]),/immutable|append.only/i);
   assert.equal((await verify.query("SELECT count(*)::integer n FROM evidence_review_resolution_events WHERE task_id=ANY($1::text[])",[[taskUnable.taskId,taskEscalated.taskId]])).rows[0].n,4);
   assert.equal((await verify.query("SELECT count(*)::integer n FROM worker_evidence_versions WHERE version_id IN ('m21007_version_unable','m21007_version_escalated') AND version_status='submitted'")).rows[0].n,2);
   const audit=(await verify.query("SELECT count(*)::integer n FROM platform_audit_events WHERE action_key IN ('verification.resolution.recorded','verification.escalation.returned') AND target_reference=ANY($1::text[])",[[taskUnable.taskId,taskEscalated.taskId]])).rows[0].n;
   assert.equal(audit,4);
  }finally{await verify.close();}
  console.log("ACTUAL_M21007_BROWSER PASS: private notes, two UNABLE, ESCALATED to Admin, returned, second Verifier, no approval and immutable reasoned history.");
 }catch(error){console.error("M21007_STAGE "+stage);throw error;}finally{await f.cleanup();}
});
