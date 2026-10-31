import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash,createHmac } from "node:crypto";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
const KEY="credential-concern-browser-signing-key-more-than-thirty-two";
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
function totp(secret){
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="";for(const c of secret)bits+=alphabet.indexOf(c).toString(2).padStart(5,"0");
 const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function port(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});}
test("Real signed issuance → public Verify/Concern/scanned evidence → Admin review/amendment → reload retained history and stale-form conflict", {timeout:240000},async()=>{
 const f=await workerAssessmentSearchFixture(),db=await openScriptDatabase({databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});
 const now=new Date().toISOString(),tenant=f.credentials.company.tenantId,order=id("assurance_order","concern"),target=id("assurance_target","concern"),caseId=id("assurance_case","concern");
 let credential,browser,concernId,fileId;
 const bytes=Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
 try{
 const workerId=(await db.query("SELECT COALESCE((SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1 LIMIT 1),worker_reference) AS permanent_worker_id FROM auth_accounts WHERE account_id=$1",[f.credentials.worker.accountId])).rows[0].permanent_worker_id;
 await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,credential_target,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,'Concern proof','CONCERN-PROOF','Concern safety credential','SUBMITTED',$4,$4,$4)",[order,tenant,f.credentials.company.membershipId,now]);
 await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'company','submitted',$7,$7)",[target,order,tenant,id("company_worker_link","concern"),f.credentials.worker.accountId,workerId,now]);
 await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'Decision pending','admin','Record decision',$8,$8)",[caseId,order,target,tenant,id("company_worker_link","concern"),f.credentials.worker.accountId,workerId,now]);
 await db.query("INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at) VALUES($1,$2,$3,$4,$5,$6,NULL,'GLOBAL',$7::jsonb,$8,$8)",[id("policy_snapshot","concern"),caseId,tenant,id("framework","concern"),id("policy","concern"),id("policy_version","concern"),JSON.stringify({credentialValidityDays:365}),now]);
 const {DecisionRepository}=loadTs("src/lib/decision/decision-engine-repository.ts"),{createDecision}=loadTs("src/lib/decision/decision-engine-domain.ts");
 await new DecisionRepository(Promise.resolve(db),KEY).saveDecisionAndProgressCase(createDecision({tenantId:tenant,caseId,state:"APPROVED",reasonCode:"ready",explanation:"Concern browser reviewed inputs are complete.",ruleVersion:"concern-browser-v1",inputReferences:["concern-assessment"],createdAt:now}),f.credentials.admin.accountId);
 credential=(await db.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0].credential_reference;
 await db.close();
 const base="http://127.0.0.1:"+await port();browser=await chromium.launch({headless:true});
 const adminContext=await browser.newContext({viewport:{width:390,height:844}});
 const publicPage=await browser.newPage(),adminPage=await adminContext.newPage(),errors=[];
 publicPage.on("pageerror",e=>errors.push(e.message));adminPage.on("pageerror",e=>errors.push(e.message));
 await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(base).port],projectRoot:process.cwd(),probeUrl:base+"/verify",environment:{...f.environment,HSE_CREDENTIAL_SIGNING_SECRET:KEY,HSE_RUNTIME_PROJECT_ROOT:f.directory},probe:async()=>{
 await publicPage.goto(base+"/verify");await publicPage.getByLabel("Worker ID or Credential ID").fill(credential);
 await publicPage.getByRole("button",{name:"Verify",exact:true}).click();await publicPage.waitForURL("**/verify/result/**");
 await publicPage.getByRole("link",{name:"Report a credential concern",exact:true}).click();
 await publicPage.getByLabel("Concern type").selectOption("document_concern");
 await publicPage.getByLabel("What is wrong?").fill("short");
 await publicPage.getByLabel("Email",{exact:true}).fill("concern.browser@example.test");
 await publicPage.locator("form").evaluate(form=>{form.noValidate=true;});
 await publicPage.getByRole("button",{name:"Submit concern",exact:true}).click();
 await publicPage.getByText("Check the concern details and contact information.",{exact:true}).waitFor({timeout:15000});
 assert.equal(await publicPage.getByLabel("What is wrong?").inputValue(),"short","Invalid concern must retain the user's draft.");
 assert.equal(await publicPage.getByLabel("Email",{exact:true}).inputValue(),"concern.browser@example.test");
 assert.equal(await publicPage.getByText("Concern reference:",{exact:true}).count(),0,"Invalid concern must not mint a reference.");
 await publicPage.getByLabel("What is wrong?").fill("Review this signed credential with independent evidence; no fraud finding is asserted.");
 await publicPage.getByLabel("Evidence (optional)").setInputFiles({name:"concern-proof.pdf",mimeType:"application/pdf",buffer:bytes});
 await publicPage.getByRole("button",{name:"Submit concern",exact:true}).click();
 const status=publicPage.locator(".public-form-status");await status.getByText(/Concern reference:/).waitFor();
 concernId=(await status.innerText()).match(/public_concern_[A-Za-z0-9_-]{24}/)[0];
 assert.match(await status.innerText(),/stored privately and queued for malware scanning/);
 await adminPage.goto(base+"/admin/login");
 await adminPage.getByLabel("Email address").fill(f.credentials.admin.email);await adminPage.getByLabel("Password",{exact:true}).fill(f.credentials.admin.password);
 await adminPage.getByLabel("Authenticator code").fill(totp(f.credentials.admin.totpSecret));await adminPage.getByRole("button",{name:"Sign in",exact:true}).click();await adminPage.waitForURL("**/admin/dashboard");
 await adminPage.goto(base+"/admin/credential-concerns");
 await adminPage.getByRole("heading",{name:"Credential concerns",exact:true}).waitFor();
 await adminPage.getByRole("link",{name:concernId,exact:true}).click();
 await adminPage.getByText("credential: "+credential,{exact:true}).waitFor();
 assert.equal(await adminPage.getByRole("link",{name:"Download scanned evidence: concern-proof.pdf",exact:true}).count(),0,"Pending private bytes are unavailable");
 }});
 // PGlite has one process owner. Stop HTTP before running the real compiled
 // outbox worker, then restart HTTP against its durable completed scan result.
 const inspect=await openScriptDatabase({databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});
 try {
 const pending=(await inspect.query("SELECT candidates.secure_file_id,files.lifecycle_status,candidates.candidate_status FROM public_verification_concern_evidence_candidates candidates JOIN platform_secure_files files ON files.file_id=candidates.secure_file_id WHERE concern_id=$1",[concernId])).rows[0];
 assert.equal(pending.lifecycle_status,"scan_pending");assert.equal(pending.candidate_status,"pending");fileId=pending.secure_file_id;
 } finally {await inspect.close();}
 const built=spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{encoding:"utf8"});assert.equal(built.status,0,built.stderr||built.stdout);
 const workerEnvironment={...f.environment,HSE_CREDENTIAL_SIGNING_SECRET:KEY,HSE_RUNTIME_PROJECT_ROOT:f.directory};
 const workerScript=`const {createRequire}=await import("node:module");const {resolve}=await import("node:path");const require=createRequire(resolve("concern-worker-test.cjs"));const {processNextOutboxJob}=require(resolve(".outbox-worker-dist/outbox/outbox-worker.js"));const {getDatabaseClient}=require(resolve(".outbox-worker-dist/database/database.js"));const {DatabaseOutboxRepository}=require(resolve(".outbox-worker-dist/outbox/outbox-repository.js"));const database=await getDatabaseClient();try{const job=await processNextOutboxJob({database,repository:new DatabaseOutboxRepository(Promise.resolve(database))});console.log(JSON.stringify({processed:job?1:0,status:job?.status??"idle",jobType:job?.jobType??null,failure:job?.lastErrorCode??null}));}finally{await database.close();}`;
 let scansCompleted=0;
 for(let count=0;count<20;count++) {
 const worker=spawnSync(process.execPath,["--input-type=module","-e",workerScript],{env:workerEnvironment,encoding:"utf8"});
 assert.equal(worker.status,0,worker.stderr||worker.stdout);
 const result=JSON.parse(worker.stdout.trim());if(result.processed===0)break;
 if(result.jobType==="email.assurance.event") {
 // Credential issuance also queues email. This fixture deliberately has no
 // live email provider; that separate job must truthfully retain its retry.
 assert.equal(result.status,"retry_wait");assert.equal(result.failure,"provider_unconfigured");
 } else {
 assert.equal(result.status,"succeeded",JSON.stringify(result));
 if(result.jobType==="secure_file.scan")scansCompleted++;
 }
 assert(count<19,"Outbox must drain within its bounded budget");
 }
 assert.equal(scansCompleted,1,"The real secure-file handler must complete the submitted scan");
 const scanned=await openScriptDatabase({databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});
 try {
 const completed=(await scanned.query("SELECT files.lifecycle_status,files.scan_result_code,candidates.candidate_status FROM public_verification_concern_evidence_candidates candidates JOIN platform_secure_files files ON files.file_id=candidates.secure_file_id WHERE concern_id=$1",[concernId])).rows[0];
 assert.equal(completed.lifecycle_status,"available");assert.equal(completed.scan_result_code,"clean");assert.equal(completed.candidate_status,"bound");
 } finally {await scanned.close();}
 await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(base).port],projectRoot:process.cwd(),probeUrl:base+"/verify",environment:workerEnvironment,probe:async()=>{
 await adminPage.goto(base+"/admin/credential-concerns/"+concernId);
 const evidence=adminPage.getByRole("link",{name:"Download scanned evidence: concern-proof.pdf",exact:true});
 const download=await adminPage.context().request.get(await evidence.getAttribute("href").then(h=>base+h));
 assert.equal(download.status(),200);assert.equal(download.headers()["cache-control"],"private, no-store");assert.deepEqual(await download.body(),bytes);
 const other=await browser.newPage();await other.goto(base+"/admin/credential-concerns/"+concernId);
 assert(!other.url().includes("/credential-concerns/"+concernId),"Signed-out concern detail must be denied");
 const stale=await adminPage.context().newPage();await stale.goto(base+"/admin/credential-concerns/"+concernId);
 const fill=async(page,reason)=>{await page.getByLabel("Review outcome").selectOption("follow_up_needed");await page.getByLabel("Reason",{exact:true}).fill(reason);await page.getByLabel("Methods used").fill("Read the exact signed credential and private scanned evidence.");await page.getByLabel("Limitations",{exact:true}).fill("The report needs external corroboration; no fraud finding was made.");};
 await fill(adminPage,"The original report requires further independent checks.");
 await adminPage.getByRole("button",{name:"Record review",exact:true}).click();await adminPage.getByRole("status").filter({hasText:"Concern review recorded."}).waitFor();
 await fill(stale,"This stale review must not overwrite the newly recorded history.");
 await stale.getByRole("button",{name:"Record review",exact:true}).click();await stale.getByRole("status").filter({hasText:"This concern changed."}).waitFor();
 await adminPage.reload();await adminPage.getByRole("heading",{name:"Review 1: follow up needed",exact:true}).waitFor();
 await fill(adminPage,"Follow-up review found no further action within the checked scope.");
 await adminPage.getByLabel("Review outcome").selectOption("reviewed_no_further_action");
 await adminPage.getByRole("button",{name:"Record amendment",exact:true}).click();await adminPage.getByRole("status").filter({hasText:"Concern review recorded."}).waitFor();
 await adminPage.reload();await adminPage.getByRole("heading",{name:"Review 1: follow up needed",exact:true}).waitFor();await adminPage.getByRole("heading",{name:"Review 2: reviewed no further action",exact:true}).waitFor();
 assert.equal(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,"Mobile concern overflow: "+JSON.stringify(await adminPage.evaluate(()=>({doc:document.documentElement.scrollWidth,inner:innerWidth,body:document.body.scrollWidth,wide:[...document.querySelectorAll("body *")].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({tag:el.tagName,class:el.className,sw:el.scrollWidth,cw:el.clientWidth,text:el.textContent?.slice(0,50)}))})))+JSON.stringify(await adminPage.evaluate(()=>[...document.querySelectorAll("body *")].map(el=>({tag:el.tagName,class:el.className,text:el.textContent?.slice(0,100),parent:el.parentElement?.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth))));
 const wrong=await adminPage.context().request.get(base+"/admin/credential-concerns/"+id("public_concern","foreign")+"/evidence/"+fileId);
 assert.equal(wrong.status(),404);assert(!await wrong.text().then(t=>t.includes("%PDF")));
 await publicPage.goto(base+"/verify");await publicPage.getByLabel("Worker ID or Credential ID").fill(credential);await publicPage.getByRole("button",{name:"Verify",exact:true}).click();await publicPage.waitForURL("**/verify/result/**");await publicPage.getByText("Valid",{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 }});
 const final=await openScriptDatabase({databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});
 try{
 const binding=(await final.query("SELECT subject_identifier,worker_reference FROM public_verification_concern_subjects WHERE concern_id=$1",[concernId])).rows[0];assert.equal(binding.subject_identifier,credential);assert.equal(binding.worker_reference,workerId);
 assert.equal(Number((await final.query("SELECT count(*) count FROM public_verification_concern_reviews WHERE concern_id=$1",[concernId])).rows[0].count),2);
 assert.equal((await final.query("SELECT status FROM credential_issuances WHERE credential_id=$1",[credential])).rows[0].status,"valid");
 assert.equal(Number((await final.query("SELECT count(*) count FROM platform_audit_events WHERE action_key='public_verification.concern.evidence.served'")).rows[0].count),1);
 }finally{await final.close();}
 }finally{await db.close().catch(()=>{});await browser?.close();await f.cleanup();}
});
