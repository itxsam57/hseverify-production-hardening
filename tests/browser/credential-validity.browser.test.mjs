import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

function pdfText(bytes){
 const parsed=spawnSync("pdftotext",["-","-"],{input:Buffer.from(bytes),encoding:"utf8"});
 assert.equal(parsed.status,0,parsed.stderr);return parsed.stdout;
}

const KEY="credential-validity-browser-ephemeral-test-signing-key-more-than-32";
const REVIEWER_EMAIL="independent-validity-reviewer@example.test";
const REVIEWER_PASSWORD="ValidityReviewer!2026";
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
// Same seeded Admin MFA convention as credential-appeal-operational-e2e.
function totp(secret,offsetSteps=0){
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="";
 for(const char of secret.toUpperCase().replace(/=+$/g,""))bits+=alphabet.indexOf(char).toString(2).padStart(5,"0");
 const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(Number.parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+offsetSteps));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const address=server.address();server.close(error=>error?reject(error):resolve(address.port));});});}

test("Browser, public API and actual PDF show the decision-pinned expiry and preserved live lifecycle",{timeout:240000},async()=>{
 const fixture=await workerAssessmentSearchFixture(),database=await openScriptDatabase({databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR}),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const {DecisionRepository}=loadTs("src/lib/decision/decision-engine-repository.ts");
 const {createDecision,createManualDecisionOverride}=loadTs("src/lib/decision/decision-engine-domain.ts");
 const {CredentialIssuanceRepository}=loadTs("src/lib/credential/credential-issuance-repository.ts");
 const credentials=new CredentialIssuanceRepository(Promise.resolve(database)),repo=new DecisionRepository(Promise.resolve(database),KEY),issued=[];
 let browser,renewalAppeal,reviewerInvitation;
 try{
  const workerId=(await database.query("SELECT COALESCE((SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1 LIMIT 1),worker_reference) AS worker_id FROM auth_accounts WHERE account_id=$1",[fixture.credentials.worker.accountId])).rows[0].worker_id;
  const renewalReference=new Date().toISOString();
  for(const [name,offset,status] of [["Expired",-31,"expired"],["Current",0,"valid"],["Suspended",-31,"suspended"],["Renewal",-31,"revoked"]]){
   const tenant=fixture.credentials.company.tenantId,caseId=id("assurance_case","validity-browser-"+name),order=id("assurance_order","validity-browser-"+name),target=id("assurance_target","validity-browser-"+name);
   const issueDate=new Date(Date.now()+offset*86400000).toISOString(),expiryDate=new Date(new Date(issueDate).getTime()+30*86400000).toISOString();
   await database.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,credential_target,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$4,$4,'SUBMITTED',$5,$5,$5)",[order,tenant,fixture.credentials.company.membershipId,"Browser "+name+" Safety",issueDate]);
   await database.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'company','submitted',$7,$7)",[target,order,tenant,id("company_worker_link",name),fixture.credentials.worker.accountId,workerId,issueDate]);
   await database.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'Decision pending','admin','Record decision',$8,$8)",[caseId,order,target,tenant,id("company_worker_link",name),fixture.credentials.worker.accountId,workerId,issueDate]);
   if(name==="Renewal"){
    const framework=id("framework",name),policy=id("policy",name),first=id("policy_version",name);
    await database.query("INSERT INTO assurance_frameworks(framework_id,framework_reference,title,created_by_account_id,created_at,updated_at) VALUES($1,'BROWSER-RENEWAL-FRAME','Browser renewal framework',$2,$3,$3)",[framework,fixture.credentials.admin.accountId,issueDate]);
    await database.query("INSERT INTO assurance_policy_packs(policy_id,framework_id,policy_reference,title,created_by_account_id,created_at,updated_at) VALUES($1,$2,'BROWSER-RENEWAL-POLICY','Browser renewal policy',$3,$4,$4)",[policy,framework,fixture.credentials.admin.accountId,issueDate]);
    for(const [version,sequence,days,from,to] of [[first,1,30,issueDate,renewalReference],[id("policy_version","Renewal-current"),2,60,renewalReference,null]]){
     await database.query("INSERT INTO assurance_policy_versions(policy_version_id,policy_id,version_no,effective_from,effective_to,policy_values,override_allowed_fields,override_directions,created_by_account_id,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,'[]'::jsonb,'{}'::jsonb,$7,$8)",[version,policy,sequence,from,to,JSON.stringify({credentialValidityDays:days}),fixture.credentials.admin.accountId,issueDate]);
    }
   }
   await database.query("INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at) VALUES($1,$2,$3,$4,$5,$6,NULL,'GLOBAL','{\"credentialValidityDays\":30}'::jsonb,$7,$7)",[id("policy_snapshot",name),caseId,tenant,id("framework",name),id("policy",name),id("policy_version",name),issueDate]);
   const decision=createDecision({tenantId:tenant,caseId,state:"APPROVED",reasonCode:"browser_ready",explanation:"Real browser credential decision.",ruleVersion:"validity-browser-v1",inputReferences:["browser-assessment"],createdAt:issueDate});
   await repo.saveDecisionAndProgressCase(decision,fixture.credentials.admin.accountId);
   const credentialId=(await database.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0].credential_reference;
   const original=await credentials.findPublic(credentialId);
   if(name==="Renewal"){
    const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts");
    renewalAppeal=await new CredentialAppealsService(Promise.resolve(database),KEY).submit({credentialId,workerId,reason:"Verified renewal evidence after expiry",evidence:["browser_renewal_evidence"],createdAt:renewalReference},"browser_validity_renewal");
   }
   if(status==="suspended"){
    const changedAt=new Date().toISOString();
    await repo.persistOverride(createManualDecisionOverride({decisionId:decision.decisionId,tenantId:tenant,previousState:"APPROVED",newState:"SUSPENDED",reason:"Browser controlled suspension after a new safety concern.",evidenceReference:"browser_safety_concern",confirmed:true,mfaVerifiedAt:changedAt,notificationRequired:true,actorReference:fixture.credentials.admin.accountId,createdAt:changedAt}));
    const suspended=await credentials.findPublic(credentialId);assert.equal(suspended.signature,original.signature);assert.equal(suspended.qrPayload,original.qrPayload);
   }
   issued.push({name,credentialId,issueDate,expiryDate,status,qrPayload:original.qrPayload});
  }
  const tampered=issued.find(value=>value.name==="Current");
  const historical=await credentials.findPublic(tampered.credentialId);
  // A fourth persisted record exercises neutral HTTP failure for modified signed expiry.
  const forgedId=id("credential_id","validity-browser-forged");
  await database.query("INSERT INTO credential_issuances(credential_id,worker_id,qualification,issued_at,expires_at,status,version,public_status_url,qr_payload,signature,pdf_url) VALUES($1,$2,$3,$4,$5,'valid',1,$6,$7,$8,$9)",[forgedId,historical.workerId,historical.qualification,historical.issuedAt,null,historical.publicStatusUrl,historical.qrPayload,historical.signature,historical.pdfUrl]);
  const {ScopedShareLinkManager}=loadTs("src/lib/share-links/scoped-share-link-domain.ts");
  const {ScopedShareLinkRepository}=loadTs("src/lib/share-links/scoped-share-link-repository.ts");
  const shareKey=createHash("sha256").update("hseverify:scoped-share-links\0","utf8").update(fixture.environment.HSE_SESSION_SECRET,"utf8").digest("hex");
  const shareManager=new ScopedShareLinkManager(shareKey),share=shareManager.create({ownerWorkerId:workerId,fields:["competencies"],purpose:"Browser live competency verification",createdAt:new Date().toISOString(),expiresAt:null});
  await new ScopedShareLinkRepository(Promise.resolve(database)).save(share.record);
  // Keep the genuine issuer history; provision a separate reviewer through the Root invitation producer.
  const {AuthAccessRepository}=loadTs("src/lib/auth/auth-access-repository.ts");
  const {StaffProvisioningService}=loadTs("src/lib/auth/staff-provisioning-service.ts");
  reviewerInvitation=await new StaffProvisioningService(new AuthAccessRepository(database),{
   pepper:fixture.environment.HSE_AUTH_PEPPER,sandboxEnabled:false,sandboxAccessKey:null
  }).createInvitation({inviterAccountId:fixture.credentials.root.accountId,inviterRole:"root",email:REVIEWER_EMAIL,role:"admin",requestFingerprint:"credential-validity-independent-reviewer"});
  await database.close();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],failed=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("requestfailed",request=>{
   const url=request.url();
   const failure=request.failure();
   // Chromium/Next may abort an in-flight document or speculative RSC fetch when
   // the test immediately redirects/reloads. Preserve every real network failure.
   if(failure?.errorText === "net::ERR_ABORTED") return;
   if(new URL(url).searchParams.has("_rsc")) return;
   failed.push(`${failure?.errorText ?? "request failed"} ${url}`);
  });
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/verify",projectRoot:process.cwd(),environment:{...fixture.environment,HSE_CREDENTIAL_SIGNING_SECRET:KEY},probe:async()=>{
   await page.goto(baseUrl+"/staff/invite/"+reviewerInvitation.token,{waitUntil:"domcontentloaded"});
   await page.getByText("Create account credentials",{exact:false}).waitFor();
   await page.getByLabel("Full name").fill("Independent validity reviewer");
   await page.getByLabel("Create password").fill(REVIEWER_PASSWORD);
   await page.getByLabel("Confirm password").fill(REVIEWER_PASSWORD);
   await page.getByRole("button",{name:"Continue to authenticator setup",exact:true}).click();
   const reviewerSecret=(await page.locator(".security-key-card strong").innerText()).trim();
   await page.getByLabel("Authenticator code").fill(totp(reviewerSecret));
   await page.getByRole("button",{name:"Activate MFA and finish enrollment",exact:true}).click();
   await page.getByText("Enrollment complete",{exact:false}).waitFor();
   await page.context().clearCookies();
   await page.goto(baseUrl+"/admin/login",{waitUntil:"domcontentloaded"});
   await page.getByLabel("Email address").fill(REVIEWER_EMAIL);await page.getByLabel("Password").fill(REVIEWER_PASSWORD);
   // Enrollment consumes the current TOTP step; an accepted adjacent step proves a fresh MFA login.
   await page.getByLabel("Authenticator code").fill(totp(reviewerSecret,1));
   await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/admin/dashboard");
   await page.goto(baseUrl+"/admin/appeals",{waitUntil:"domcontentloaded"});
   const review=page.getByRole("form",{name:"Review "+renewalAppeal.appealId,exact:true});
   await review.getByLabel("Review status").selectOption("accepted");
   await review.getByLabel("Accepted-outcome action").selectOption("renew");
   await review.getByLabel("Reasoned review outcome",{exact:true}).fill("Independent review confirms the verified renewal evidence meets the current configured policy.");
   await review.getByRole("button",{name:"Record appeal review",exact:true}).click();
   await page.getByRole("status").filter({hasText:"Appeal review recorded."}).waitFor();
   await page.reload({waitUntil:"domcontentloaded"});
   assert((await page.locator("article").filter({hasText:renewalAppeal.appealId}).innerText()).includes("Status: accepted"));
   await page.context().clearCookies();
   // Software detector simulation proves actual persisted issuance -> scanner -> live server lookup.
   // It does not prove camera hardware or optical decoding.
   await page.addInitScript(()=>{
    window.__scannerStops=0;
    window.BarcodeDetector=class{async detect(){return [{rawValue:window.__scannerPayload}];}};
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>new MediaStream()}});
    HTMLMediaElement.prototype.play=async function(){};
   });
   const scanned=issued.find(value=>value.name==="Suspended");
   await page.goto(baseUrl+"/verify",{waitUntil:"domcontentloaded"});
   await page.evaluate(payload=>{window.__scannerPayload=payload;},scanned.qrPayload);
   await page.getByRole("button",{name:"Scan QR",exact:true}).click();
   await page.getByText("QR code read. Review the ID, then choose Verify.",{exact:true}).waitFor();
   assert.equal(await page.getByLabel("Worker ID or Credential ID",{exact:true}).inputValue(),scanned.credentialId);
   await page.getByRole("button",{name:"Verify",exact:true}).click();
   await page.getByRole("heading",{name:"HSE Verify credential",exact:true}).waitFor();
   assert.equal(await page.locator(".status-badge").innerText(),"Suspended");
   await page.reload({waitUntil:"domcontentloaded"});assert.equal(await page.locator(".status-badge").innerText(),"Suspended");
   for(const value of issued){
    await page.goto(baseUrl+"/verify/result/"+value.credentialId,{waitUntil:"domcontentloaded"});
    await page.getByRole("heading",{name:"HSE Verify credential",exact:true}).waitFor();
    assert.equal(await page.locator(".status-badge").innerText(),value.status[0].toUpperCase()+value.status.slice(1));
    assert.equal(await page.getByText(value.credentialId,{exact:true}).count(),1);
    assert.equal(await page.locator("dt").filter({hasText:"Expires"}).count(),1);
    await page.reload({waitUntil:"domcontentloaded"});assert.equal(await page.locator(".status-badge").innerText(),value.status[0].toUpperCase()+value.status.slice(1));
    const api=await page.request.get(baseUrl+"/api/credentials/"+value.credentialId);assert.equal(api.status(),200);
    const record=await api.json();assert.equal(record.status,value.status);assert.equal(record.issuedAt,value.issueDate);assert.equal(record.expiresAt,value.expiryDate);
    if(value.name==="Renewal")assert(record.restrictions.includes("This issuance has been replaced. Verify the current credential shared by the Worker."));
    assert.equal(JSON.stringify(record).includes(historical.workerId),false);assert.equal(JSON.stringify(record).includes("signature"),false);
    const pdf=await page.request.get(baseUrl+"/api/credentials/"+value.credentialId+"/pdf");assert.equal(pdf.status(),200);assert.equal(pdf.headers()["content-type"],"application/pdf");assert.equal(pdf.headers()["cache-control"],"no-store");
    const bytes=await pdf.body();assert(bytes.subarray(0,8).toString().startsWith("%PDF-"));const text=pdfText(bytes);assert(text.includes("Issue: "+value.issueDate));assert(text.includes("Expiry: "+value.expiryDate));assert(text.includes("Status: "+value.status));assert.equal(text.includes(historical.signature),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
   }
   await page.goto(baseUrl+share.shareUrl,{waitUntil:"domcontentloaded"});
   const shareText=await page.locator("main").innerText();
   assert(shareText.includes("Browser Expired Safety"));assert(shareText.includes("expired"));assert(shareText.includes("suspended"));
   await page.goto(baseUrl+"/worker/login",{waitUntil:"domcontentloaded"});
   await page.getByLabel("Email address").fill(fixture.credentials.worker.email);await page.getByLabel("Password").fill(fixture.credentials.worker.password);
   await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/worker/dashboard");
   await page.goto(baseUrl+"/worker/passport",{waitUntil:"domcontentloaded"});
   const expiredItem=page.getByRole("list",{name:"Assessed competencies"}).locator("li").filter({hasText:"Browser Expired Safety"});
   assert((await expiredItem.innerText()).includes("expired"));
   await page.reload({waitUntil:"domcontentloaded"});assert((await expiredItem.innerText()).includes("expired"));
   const history=page.getByRole("region",{name:"Living Record history",exact:true});
   assert((await history.innerText()).includes("valid"));
   const currentRenewal=page.getByRole("list",{name:"Assessed competencies"}).locator("li").filter({hasText:"Browser Renewal Safety"}).filter({hasText:"valid"});
   assert.equal(await currentRenewal.count(),1);
   const renewalHref=await currentRenewal.getByRole("link",{name:"Verify credential",exact:true}).getAttribute("href");
   const replacementId=renewalHref.slice("/verify/result/".length);
   assert.notEqual(replacementId,issued.find(value=>value.name==="Renewal").credentialId);
   const renewalApi=await page.request.get(baseUrl+"/api/credentials/"+replacementId);assert.equal(renewalApi.status(),200);
   const renewed=await renewalApi.json();assert.equal(renewed.status,"valid");assert.equal(new Date(renewed.expiresAt).getTime()-new Date(renewed.issuedAt).getTime(),60*86400000);
   const renewalPdf=await page.request.get(baseUrl+"/api/credentials/"+replacementId+"/pdf");assert.equal(renewalPdf.status(),200);
   const renewedPdfText=pdfText(await renewalPdf.body());assert(renewedPdfText.includes("Status: valid"));assert(renewedPdfText.includes("Expiry: "+renewed.expiresAt));
   await currentRenewal.getByRole("link",{name:"Verify credential",exact:true}).click();
   await page.getByRole("heading",{name:"HSE Verify credential",exact:true}).waitFor();assert.equal(await page.locator(".status-badge").innerText(),"Valid");
   await page.reload({waitUntil:"domcontentloaded"});assert.equal(await page.locator(".status-badge").innerText(),"Valid");
   const neutral=await page.request.get(baseUrl+"/api/credentials/"+forgedId);assert.equal(neutral.status(),404);assert.deepEqual(await neutral.json(),{status:"not_found_or_invalid"});
   assert.equal((await page.request.get(baseUrl+"/api/credentials/"+forgedId+"/pdf")).status(),404);
   assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  }});
  assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const persisted=await openScriptDatabase({databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
  try{
   const proof=await persisted.query(`SELECT appeal.status,appeal.outcome_action,appeal.reviewer_account_id,
    reviewer.email_normalized AS reviewer_email,event.reviewer_account_id AS event_reviewer,
    original.actor_account_id AS issuer_account_id,replacement.actor_account_id AS replacement_actor,
    invitation.invited_by_account_id,invitation.accepted_by_account_id,invitation.invitation_status AS invitation_status
    FROM credential_appeals appeal JOIN auth_accounts reviewer ON reviewer.account_id=appeal.reviewer_account_id
    JOIN credential_appeal_events event ON event.appeal_id=appeal.appeal_id AND event.version=appeal.version
    JOIN credential_replacements replacement ON replacement.appeal_id=appeal.appeal_id
    JOIN assurance_case_timeline_events original ON original.case_id=replacement.old_case_id AND original.event_type='decision_recorded'
    JOIN auth_staff_invitations invitation ON invitation.invitation_id=$2
    WHERE appeal.appeal_id=$1`,[renewalAppeal.appealId,reviewerInvitation.invitation.invitationId]);
   assert.equal(proof.rows.length,1);
   const row=proof.rows[0];
   assert.equal(row.status,"accepted");assert.equal(row.outcome_action,"renew");
   assert.equal(row.reviewer_email,REVIEWER_EMAIL);
   assert.equal(row.issuer_account_id,fixture.credentials.admin.accountId);
   assert.notEqual(row.reviewer_account_id,row.issuer_account_id);
   assert.equal(row.event_reviewer,row.reviewer_account_id);
   assert.equal(row.replacement_actor,row.reviewer_account_id);
   assert.equal(row.invited_by_account_id,fixture.credentials.root.accountId);
   assert.equal(row.invitation_status,"accepted");
   assert.equal(row.accepted_by_account_id,row.reviewer_account_id);
  }finally{await persisted.close();}
 }finally{if(browser)await browser.close();await database.close().catch(()=>{});await fixture.cleanup();}
});
