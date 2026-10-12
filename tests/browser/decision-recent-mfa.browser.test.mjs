import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

function totp(secret) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", bits=[...secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const count=Buffer.alloc(8);count.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(count).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}

async function seedDecisionPendingCase(database, options = {}) {
  const tenantId = "tenant_aaaaaaaaaaaaaaaaaaaaaaaa";
  const orderId = "assurance_order_bbbbbbbbbbbbbbbbbbbbbbbb";
  const targetId = "assurance_target_cccccccccccccccccccccccc";
  const caseId = "assurance_case_dddddddddddddddddddddddd";
  const now = "2026-09-25T10:00:00.000Z";

  await database.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       credential_target,order_status,submitted_at,created_at,updated_at
     ) VALUES($1,$2,'membership_acceptance_owner','Decision progression order','DECISION-RUNTIME-1',
       $3,'SUBMITTED',$4,$4,$4)`,
    [orderId, tenantId, options.credentialTarget ?? null, now]
  );
  await database.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,
       permanent_worker_id,funding_method,target_status,created_at,updated_at
     ) VALUES($1,$2,$3,'worker_link_acceptance_01','worker_account_acceptance_01',
       'worker_id_acceptance_000001','company','submitted',$4,$4)`,
    [targetId, orderId, tenantId, now]
  );
  await database.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
       permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at
     ) VALUES($1,$2,$3,$4,'worker_link_acceptance_01','worker_account_acceptance_01',
       'worker_id_acceptance_000001','Decision pending','admin',
       'Record the final Assurance Case decision.',$5,$5)`,
    [caseId, orderId, targetId, tenantId, now]
  );
  await database.query(
    `INSERT INTO assurance_action_items(
       action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,
       owner_kind,allowed_action,deep_link,statutory,action_status,created_at,updated_at
     ) VALUES('assurance_action_eeeeeeeeeeeeeeeeeeeeeeee',$1,$2,$3,
       'worker_account_acceptance_01','warning','Record the final decision.','admin',
       'open_case',$4,false,'open',$5,$5)`,
    [tenantId, orderId, caseId, `/company/assurance-orders/${orderId}#${caseId}`, now]
  );
  return { tenantId, orderId, caseId };
}

test("Real MFA login permits decision override; stale session and forged browser timestamp produce no mutation",{timeout:300000},async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),"hse-decision-mfa-"));
 const credentialPath=join(dataDir,"credentials.json");
 const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dataDir,HSE_AUDIT_CREDENTIALS_PATH:credentialPath,HSE_RELEASE_SHA:"decision-mfa-browser",HSE_SESSION_SECRET:"decision-mfa-browser-session-secret-2026-32",HSE_AUTH_PEPPER:"decision-mfa-browser-auth-pepper-2026-32",HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 let cookies,decisionId,scope;
 const port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
 async function dbWork(fn){const db=new PGlite(dataDir);try{return await fn(db);}finally{await db.close();}}
 async function run(probe){return runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",projectRoot:process.cwd(),environment,probe});}
 async function login(page,admin){await page.goto(baseUrl+"/admin/login");await page.getByLabel("Email address").fill(admin.email);await page.getByLabel("Password",{exact:true}).fill(admin.password);await page.getByLabel("Authenticator code").fill(totp(admin.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/admin/dashboard");}
 async function override(page){
  await page.goto(baseUrl+"/admin/decisions?tenantId="+scope.tenantId+"&caseId="+scope.caseId);
  const form=page.locator("form").filter({has:page.getByRole("button",{name:"Record override",exact:true})});
  await form.getByLabel("Decision ID").fill(decisionId);
  await form.locator("[name=previousState]").selectOption("PENDING_ADDITIONAL_REVIEW");
  await form.locator("[name=newState]").selectOption("REJECTED");
  await form.getByLabel("Reason",{exact:true}).fill("Controlled override with verified supporting evidence");
  await form.getByLabel("Evidence reference").fill("evidence-mfa-browser");
  await form.evaluate(form=>{const i=document.createElement("input");i.name="mfaVerifiedAt";i.value=new Date().toISOString();i.type="hidden";form.append(i);});
  await form.getByRole("button",{name:"Record override",exact:true}).click();
 }
 async function snapshot(db){
  return {
   decision:(await db.query("SELECT state FROM platform_decisions WHERE decision_id=$1",[decisionId])).rows,
   overrides:(await db.query("SELECT override_id FROM platform_decision_overrides WHERE decision_id=$1",[decisionId])).rows,
   case:(await db.query("SELECT case_status,decision_reference FROM assurance_cases WHERE case_id=$1",[scope.caseId])).rows,
   timeline:(await db.query("SELECT event_type FROM assurance_case_timeline_events WHERE case_id=$1 ORDER BY occurred_at",[scope.caseId])).rows,
   audit:(await db.query("SELECT audit_event_id FROM platform_audit_events WHERE action_key='decision.override.created'")).rows,
   living:(await db.query("SELECT * FROM living_record_versions")).rows
  };
 }
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const {admin}=JSON.parse(await readFile(credentialPath,"utf8"));
  scope=await dbWork(db=>seedDecisionPendingCase(db));
  await run(async()=>{const browser=await chromium.launch({headless:true});try{
   const context=await browser.newContext(),page=await context.newPage();await login(page,admin);
   await page.goto(baseUrl+"/admin/decisions?tenantId="+scope.tenantId+"&caseId="+scope.caseId);
   assert.equal(new URL(page.url()).pathname,"/admin/decisions",await page.locator("body").innerText());
   const form=page.locator("form").filter({has:page.getByRole("button",{name:"Create decision",exact:true})});
   await form.locator("[name=state]").selectOption("PENDING_ADDITIONAL_REVIEW");
   await form.getByLabel("Reason code").fill("mfa_review");
   await form.getByLabel("Explanation").fill("Additional independent verification required before approval");
   await form.getByLabel("Rule version").fill("mfa-v1");
   await form.getByLabel("Input references").fill("evidence-mfa-browser");
   await form.getByRole("button",{name:"Create decision",exact:true}).click();
   await page.locator(".side-record-card code").first().waitFor();
   decisionId=await page.locator(".side-record-card code").first().innerText();
   cookies=await context.cookies();
  }finally{await browser.close();}});
  const before=await dbWork(async db=>{
   const login=(await db.query("SELECT metadata FROM auth_security_events WHERE account_id=$1 AND event_type='login_succeeded' ORDER BY occurred_at DESC LIMIT 1",[admin.accountId])).rows[0];
   assert.ok(login.metadata.mfaEventId,"actual login must bind completed MFA event");
   await db.query("UPDATE auth_security_events SET occurred_at=CURRENT_TIMESTAMP-interval '10 minutes' WHERE event_id=$1",[login.metadata.mfaEventId]);
   return snapshot(db);
  });
  await run(async()=>{const browser=await chromium.launch({headless:true});try{
   const context=await browser.newContext();await context.addCookies(cookies);const page=await context.newPage();
   await override(page);await page.getByRole("alert").getByText("Sign in again with MFA before overriding a decision.",{exact:true}).waitFor();
   console.log("ACTUAL_BROWSER stale authenticated session plus forged current MFA timestamp denied");
  }finally{await browser.close();}});
  await dbWork(async db=>assert.deepEqual(await snapshot(db),before,"denied override changed downstream state"));
  // Recovery-code verification is real MFA, avoids reusing an already consumed TOTP counter.
  const {hashOpaqueValue,createIdentifier}=await import("../helpers/worker-registration-runtime-loader.mjs").then(m=>m.loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts"));
  await dbWork(db=>db.query("INSERT INTO auth_mfa_recovery_codes(recovery_code_id,account_id,code_hash,created_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)",[createIdentifier("mfa_recovery"),admin.accountId,hashOpaqueValue("MFA1-REAL-0001",environment.HSE_AUTH_PEPPER,"mfa-recovery")]));
  await run(async()=>{const browser=await chromium.launch({headless:true});try{
   const page=await browser.newPage();await page.goto(baseUrl+"/admin/login");
   await page.getByLabel("Email address").fill(admin.email);await page.getByLabel("Password",{exact:true}).fill(admin.password);await page.getByLabel("Authenticator code").fill("MFA1-REAL-0001");
   await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/admin/dashboard");
   await override(page);await page.getByText("Controlled override with verified supporting evidence",{exact:true}).waitFor();
   console.log("ACTUAL_BROWSER completed recovery-code MFA login permitted override");
  }finally{await browser.close();}});
  await dbWork(async db=>{
   const rows=(await db.query("SELECT o.previous_state,o.new_state,o.mfa_verified_at,o.actor_reference,o.notification_required,m.occurred_at AS trusted_mfa_at FROM platform_decision_overrides o JOIN auth_security_events l ON l.account_id=o.actor_reference AND l.event_type='login_succeeded' JOIN auth_security_events m ON m.event_id=l.metadata->>'mfaEventId' WHERE o.decision_id=$1 AND m.metadata->>'method'='recovery_code'",[decisionId])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].new_state,"REJECTED");assert.equal(rows[0].actor_reference,admin.accountId);assert.equal(rows[0].notification_required,true);
   assert.equal(new Date(rows[0].mfa_verified_at).toISOString(),new Date(rows[0].trusted_mfa_at).toISOString());
   const after=await snapshot(db);assert.equal(after.decision[0].state,"REJECTED");assert.equal(after.case[0].case_status,"Rejected");assert.equal(after.overrides.length,1);assert.equal(after.timeline.filter(x=>x.event_type==="decision_override_applied").length,1);assert.equal(after.audit.length,1);
   console.log("ACTUAL_DB trusted completed MFA timestamp persisted with decision, Assurance Case timeline and audit");
  });
 }finally{await rm(dataDir,{recursive:true,force:true});}
});
