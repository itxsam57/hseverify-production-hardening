import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes = []; for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter = Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=hash.at(-1)&15;
  return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){return new Promise((resolve,reject)=>{const server=createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const p=server.address().port;server.close(e=>e?reject(e):resolve(p));});});}
async function login(page,url,actor,role){
  await page.goto(url+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(actor.email);
  await page.getByLabel("Password",{exact:true}).fill(actor.password);
  if(actor.totpSecret) await page.getByLabel("Authenticator code").fill(totp(actor.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:25000});
}
async function fixtureCases(db,creds){
 const now=new Date().toISOString(),tenant=creds.company.tenantId,company=creds.company,worker=creds.worker;
 assert.ok(tenant && company.membershipId && worker.accountId);
 const link="company_worker_link_"+"z".repeat(24),invitation="worker_invitation_"+"z".repeat(24);
 await db.query("INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at) VALUES($1,$2,$3,$4,'accepted',$5,$6,clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())",[invitation,tenant,worker.email,"m21302-scoped-invitation",company.membershipId,worker.accountId]);
 await db.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,worker_accepted_at,activated_at) VALUES($1,$2,$3,'invitation',$4,'active',clock_timestamp(),clock_timestamp())",[link,tenant,worker.accountId,invitation]);
 const cases={};
 for(const [kind,suffix] of [["review","r"],["evidence","e"],["interview","i"]]){
   const orderId="assurance_order_"+suffix.repeat(24),targetId="assurance_target_"+suffix.repeat(24),caseId="assurance_case_"+suffix.repeat(24);
   await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'SUBMITTED',$6,$6,$6)",[orderId,tenant,company.membershipId,"M2.13.02 "+kind,"M21302-"+kind,now]);
   await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'company','submitted',$6,$6)",[targetId,orderId,tenant,link,worker.accountId,now]);
   await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Decision pending','admin','Record final decision.',$7,$7)",[caseId,orderId,targetId,tenant,link,worker.accountId,now]);
   cases[kind]={tenant,orderId,caseId};
 }
 return cases;
}
async function decision(page,url,c,state){
 await page.goto(url+"/admin/decisions?tenantId="+c.tenant+"&caseId="+c.caseId,{waitUntil:"domcontentloaded"});
 const form=page.locator("form").filter({has:page.getByRole("button",{name:"Create decision",exact:true})});
 await form.locator('[name="state"]').selectOption(state);
 await form.getByLabel("Reason code").fill("needs_followup");
 await form.getByLabel("Explanation").fill("Human follow-up is required before the case can close.");
 await form.getByLabel("Rule version").fill("m21302-browser");
 await form.getByLabel("Input references").fill("recorded-follow-up-request");
 await form.getByRole("button",{name:"Create decision",exact:true}).click();
}
test("M2.13.02 Admin decision routes review, evidence and interview to responsible roles",{timeout:260000},async()=>{
 const root=await mkdtemp(join(tmpdir(),"hse-m21302-browser-")),dir=join(root,"db"),credsFile=join(root,"creds.json"),number=await freePort(),url="http://127.0.0.1:"+number;
 const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,HSE_AUDIT_CREDENTIALS_PATH:credsFile,HSE_RELEASE_SHA:"m21302-browser",HSE_SESSION_SECRET:"m21302-browser-test-session-secret-2026",HSE_AUTH_PEPPER:"m21302-browser-test-pepper-secret-2026",HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 try {
  for(const file of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
    const r=spawnSync(process.execPath,[file],{env:environment,encoding:"utf8"});
    assert.equal(r.status,0,r.stderr||r.stdout);
  }
  const creds=JSON.parse(await readFile(credsFile,"utf8"));
  const db=new PGlite(dir);let cases;try{cases=await fixtureCases(db,creds)}finally{await db.close()}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(number)],probeUrl:url+"/admin/login",projectRoot:process.cwd(),environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});try{
    const admin=await browser.newPage();await login(admin,url,creds.admin,"admin");
    await decision(admin,url,cases.review,"PENDING_ADDITIONAL_REVIEW");
    const alert=admin.locator(".status-banner.status-error");await alert.waitFor({timeout:20000});
    const reviewMessage=(await alert.innerText()).trim();
    console.log("M21302_REVIEW_DENIAL:",reviewMessage);
    assert.match(reviewMessage,/Additional review requires a submitted assessment review source/i,"Admin must know why no independent Verifier queue was created");
    await decision(admin,url,cases.evidence,"ADDITIONAL_EVIDENCE_REQUIRED");
    await admin.getByRole("heading",{name:"ADDITIONAL EVIDENCE REQUIRED",exact:true}).waitFor({timeout:20000});
    await decision(admin,url,cases.interview,"INTERVIEW_PENDING");
    await admin.getByRole("heading",{name:"INTERVIEW PENDING",exact:true}).waitFor({timeout:20000});
    await admin.goto(url+"/admin/assessor-matching",{waitUntil:"domcontentloaded"});await admin.getByRole("heading",{name:/Assessor matching/i}).first().waitFor({timeout:20000});
    const worker=await browser.newPage();await login(worker,url,creds.worker,"worker");
    await worker.goto(url+"/worker/assurance-cases/"+cases.evidence.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByText("Status: Evidence pending",{exact:true}).waitFor({timeout:20000});
    await worker.getByRole("link",{name:"Add or correct requested evidence"}).waitFor();
    await worker.goto(url+"/worker/assurance-cases/"+cases.interview.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByText("Status: Interview pending",{exact:true}).waitFor({timeout:20000});
    const company=await browser.newPage();await login(company,url,creds.company,"company");
    for(const [kind,status] of [["evidence","Evidence pending"],["interview","Interview pending"]]){
      await company.goto(url+"/company/assurance-orders/"+cases[kind].orderId,{waitUntil:"domcontentloaded"});
      await company.getByText(status,{exact:true}).first().waitFor({timeout:20000});
    }
    const verifier=await browser.newPage();await login(verifier,url,creds.verifier,"verifier");
    await verifier.goto(url+"/verifier/reviews/scoring",{waitUntil:"domcontentloaded"});
    await verifier.getByRole("heading",{name:"Written scoring review",exact:true}).waitFor();
    assert.equal(await verifier.locator("tbody tr").filter({hasText:cases.review.caseId}).count(),0,"A missing submitted review source must not create a Verifier scoring job");
    const assessor=await browser.newPage();await login(assessor,url,creds.assessor,"assessor");
    await assessor.goto(url+"/assessor/interviews",{waitUntil:"domcontentloaded"});
    await assessor.getByRole("heading",{name:"Interview assignments",exact:true}).waitFor();
    assert.equal(await assessor.getByText(cases.interview.caseId,{exact:true}).count(),0,"Unassigned interview must not appear as an Assessor assignment");
    console.log("M21302_ROLE_ISOLATION verified Verifier has no phantom task and Assessor has no unassigned request");
    console.log("M21302_BROWSER_UI verified Admin, Worker, Company status and actions");
   }finally{await browser.close();}
  }});
  const checked=new PGlite(dir);try{
    for(const kind of ["review","evidence","interview"]){
      const c=cases[kind],row=(await checked.query("SELECT case_status,owner_kind,interview_reference,decision_reference FROM assurance_cases WHERE case_id=$1",[c.caseId])).rows[0];
      if(kind==="review"){assert.equal(row.case_status,"Decision pending");assert.equal(row.decision_reference,null);}
      if(kind==="evidence"){assert.equal(row.case_status,"Evidence pending");assert.equal(row.owner_kind,"worker");}
      if(kind==="interview"){assert.equal(row.case_status,"Interview pending");assert.equal(row.owner_kind,"admin");assert.ok(row.interview_reference);}
      const items=(await checked.query("SELECT owner_kind,deep_link FROM assurance_action_items WHERE case_id=$1 AND action_status='open'",[c.caseId])).rows;
      if(kind==="evidence")assert.deepEqual(items.map(x=>[x.owner_kind,x.deep_link]),[["worker","/worker/assurance-cases/"+c.caseId]]);
      if(kind==="interview")assert.deepEqual(items.map(x=>[x.owner_kind,x.deep_link]),[["admin","/admin/assessor-matching"]]);
    }
    const interviews=(await checked.query("SELECT status,assessor_account_id FROM interview_requests WHERE case_id=$1",[cases.interview.caseId])).rows;
    assert.equal(interviews.length,1);assert.equal(interviews[0].status,"REQUESTED");assert.equal(interviews[0].assessor_account_id,null);
  }finally{await checked.close()}
 }finally{await rm(root,{recursive:true,force:true})}
});
