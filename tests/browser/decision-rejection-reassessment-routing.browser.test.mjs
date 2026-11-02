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
 await db.query("INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at) VALUES($1,$2,$3,$4,'accepted',$5,$6,clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())",[invitation,tenant,worker.email,"m21303-scoped-invitation",company.membershipId,worker.accountId]);
 await db.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,worker_accepted_at,activated_at) VALUES($1,$2,$3,'invitation',$4,'active',clock_timestamp(),clock_timestamp())",[link,tenant,worker.accountId,invitation]);
 const cases={};
 for(const [kind,suffix] of [["rejected","r"],["reassessment","s"]]){
   const orderId="assurance_order_"+suffix.repeat(24),targetId="assurance_target_"+suffix.repeat(24),caseId="assurance_case_"+suffix.repeat(24);
   await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'SUBMITTED',$6,$6,$6)",[orderId,tenant,company.membershipId,"M2.13.03 "+kind,"M21303-"+kind,now]);
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
 await form.getByLabel("Rule version").fill("m21303-browser");
 await form.getByLabel("Input references").fill("recorded-follow-up-request");
 await form.getByRole("button",{name:"Create decision",exact:true}).click();
}
test("M2.13.03 Rejected and Reassessment Required show truthful correction paths across roles",{timeout:220000},async()=>{
 const root=await mkdtemp(join(tmpdir(),"hse-m21303-browser-")),dir=join(root,"db"),credsFile=join(root,"creds.json"),number=await freePort(),url="http://127.0.0.1:"+number;
 const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,HSE_AUDIT_CREDENTIALS_PATH:credsFile,HSE_RELEASE_SHA:"m21303-browser",HSE_SESSION_SECRET:"m21303-browser-session-secret-long-2026",HSE_AUTH_PEPPER:"m21303-browser-auth-pepper-long-2026",HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
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
    await decision(admin,url,cases.rejected,"REJECTED");
    await admin.getByRole("heading",{name:"REJECTED",exact:true}).waitFor({timeout:20000});
    await decision(admin,url,cases.reassessment,"REASSESSMENT_REQUIRED");
    await admin.getByRole("heading",{name:"REASSESSMENT REQUIRED",exact:true}).waitFor({timeout:20000});
    const worker=await browser.newPage();await login(worker,url,creds.worker,"worker");
    await worker.goto(url+"/worker/assurance-cases/"+cases.reassessment.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByText("Status: Reassessment required",{exact:true}).waitFor({timeout:20000});
    const reassess=worker.getByRole("link",{name:"Check reassessment eligibility",exact:true});
    await reassess.waitFor({timeout:10000});
    assert.equal(await reassess.getAttribute("href"),"/worker/assessment-applications");
    await reassess.click();
    await worker.waitForURL("**/worker/assessment-applications",{timeout:20000});
    await worker.getByRole("heading",{name:"Apply and fund an assessment",exact:true}).waitFor();
    await worker.goto(url+"/worker/assurance-cases/"+cases.rejected.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByText("Status: Rejected",{exact:true}).waitFor({timeout:20000});
    assert.equal(await worker.locator("p").filter({has:worker.getByText("Next action:",{exact:true})}).count(),0,"Closed rejected case must not show an empty next action");
    const correction=worker.getByRole("link",{name:"Request help with rejected case",exact:true});
    await correction.waitFor({timeout:10000});
    assert.equal(await correction.getAttribute("href"),"/contact");
    await correction.click();
    await worker.waitForURL("**/contact",{timeout:20000});
    await worker.getByRole("heading",{name:"Contact HSE Verify",exact:true}).waitFor();
    const company=await browser.newPage();await login(company,url,creds.company,"company");
    for(const [kind,status] of [["rejected","Rejected"],["reassessment","Reassessment required"]]){
      await company.goto(url+"/company/assurance-orders/"+cases[kind].orderId,{waitUntil:"domcontentloaded"});
      await company.getByText(status,{exact:true}).first().waitFor({timeout:20000});
    }
    console.log("M21303_BROWSER Worker and Company statuses; policy-gated application and support destinations opened");
   }finally{await browser.close();}
  }});
  const checked=new PGlite(dir);try{
    for(const [kind,expected,owner] of [["rejected","Rejected",null],["reassessment","Reassessment required","worker"]]){
      const c=cases[kind],row=(await checked.query("SELECT case_status,owner_kind,decision_reference,credential_reference,closed_at FROM assurance_cases WHERE case_id=$1",[c.caseId])).rows[0];
      assert.equal(row.case_status,expected);assert.equal(row.owner_kind,owner);assert.ok(row.decision_reference);
      assert.equal(row.credential_reference,null,"Negative decisions must never issue a credential");
      assert.equal(Boolean(row.closed_at),kind==="rejected");
      const decisions=(await checked.query("SELECT state FROM platform_decisions WHERE case_id=$1",[c.caseId])).rows;
      assert.deepEqual(decisions.map(d=>d.state),[kind==="rejected"?"REJECTED":"REASSESSMENT_REQUIRED"]);
      const action=(await checked.query("SELECT owner_kind,deep_link FROM assurance_action_items WHERE case_id=$1 AND action_status='open'",[c.caseId])).rows;
      if(kind==="reassessment")assert.deepEqual(action.map(x=>[x.owner_kind,x.deep_link]),[["worker","/worker/assurance-cases/"+c.caseId]]);
      else assert.equal(action.length,0);
    }
  }finally{await checked.close()}
 }finally{await rm(root,{recursive:true,force:true})}
});