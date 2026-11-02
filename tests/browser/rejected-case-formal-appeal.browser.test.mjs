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
test("M2.13.03 rejected unissued case appeal preserves source and requires independent MFA reviewer",{timeout:240000},async()=>{
 const root=await mkdtemp(join(tmpdir(),"hse-case-appeal-")),dir=join(root,"db"),credsFile=join(root,"creds.json"),port=await freePort(),url="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,HSE_AUDIT_CREDENTIALS_PATH:credsFile,HSE_RELEASE_SHA:"m21303-case-appeal",HSE_SESSION_SECRET:"m21303-case-appeal-session-secret-long-2026",HSE_AUTH_PEPPER:"m21303-case-appeal-pepper-secret-long-2026",HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 try{
  for(const file of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
   const result=spawnSync(process.execPath,[file],{env:environment,encoding:"utf8"});
   assert.equal(result.status,0,result.stderr||result.stdout);
  }
  const creds=JSON.parse(await readFile(credsFile,"utf8"));
  const secondAccount="case_appeal_independent_admin_2026",secondEmail="case.appeal.independent@example.test";
  const second={...creds.admin,accountId:secondAccount,email:secondEmail};
  const foreignAccount="case_appeal_foreign_worker_2026",foreignEmail="case.appeal.other@example.test";
  const foreign={...creds.worker,accountId:foreignAccount,email:foreignEmail,totpSecret:null};
  const db=new PGlite(dir);let c;
  try{
   c=(await fixtureCases(db,creds)).rejected;
   const now=new Date().toISOString();
   await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
     SELECT $1,$2,'Independent case appeal reviewer','active',password_hash,$3,$3,$3,$3 FROM auth_accounts WHERE account_id=$4`,
     [secondAccount,secondEmail,now,creds.admin.accountId]);
   await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[secondAccount]);
   await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
     SELECT $1,$2,'Unrelated Worker','active',password_hash,$3,$3,$3,$3 FROM auth_accounts WHERE account_id=$4`,
     [foreignAccount,foreignEmail,now,creds.worker.accountId]);
   await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'worker')",[foreignAccount]);
   await db.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,created_at,activated_at)
    SELECT $1,$2,factor_type,encrypted_secret,'active',clock_timestamp(),clock_timestamp() FROM auth_mfa_factors WHERE account_id=$3 AND factor_status='active'`,
    ["independent_case_appeal_factor",secondAccount,creds.admin.accountId]);
  }finally{await db.close()}
  let appealId;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:url+"/admin/login",projectRoot:process.cwd(),environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const originalAdmin=await browser.newPage();await login(originalAdmin,url,creds.admin,"admin");
    await decision(originalAdmin,url,c,"REJECTED");
    await originalAdmin.getByRole("heading",{name:"REJECTED",exact:true}).waitFor({timeout:20000});
    const worker=await browser.newPage();await login(worker,url,creds.worker,"worker");
    const unrelated=await browser.newPage();await login(unrelated,url,foreign,"worker");
    await unrelated.goto(url+"/worker/case-appeals?caseId="+c.caseId,{waitUntil:"domcontentloaded"});
    assert.equal(await unrelated.getByRole("button",{name:"Submit case appeal"}).count(),0,"Foreign Worker must not receive a rejected case appeal form");
    assert.equal(await unrelated.getByText(c.caseId,{exact:true}).count(),0,"Foreign Worker must not see another Worker case reference");
    console.log("M21303_CROSS_WORKER_APPEAL_DENIED");
    await worker.goto(url+"/worker/assurance-cases/"+c.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByRole("link",{name:"Appeal this rejected case"}).click();
    await worker.waitForURL(url+"/worker/case-appeals?caseId="+c.caseId,{timeout:20000});
    await worker.getByLabel("Appeal grounds").fill("The rejected competence determination overlooked submitted evidence and must be independently reconsidered.");
    await worker.getByRole("button",{name:"Submit case appeal"}).click();
    await worker.waitForURL("**/worker/case-appeals?status=submitted",{timeout:20000});
    await worker.getByText("Case appeal submitted for independent Admin review.",{exact:true}).waitFor();
    const article=worker.locator("article").filter({hasText:c.caseId});
    await article.getByText("Status: submitted",{exact:false}).waitFor();
    appealId=await article.getAttribute("id");
    assert.ok(/^case_appeal_/.test(appealId));
    console.log("M21303_FORMAL_APPEAL_WORKER_SUBMITTED",appealId);
    await worker.goto(url+"/worker/case-appeals?caseId="+c.caseId,{waitUntil:"domcontentloaded"});
    await worker.getByLabel("Appeal grounds").fill("I request another independent look at the retained rejected case decision.");
    await worker.getByRole("button",{name:"Submit case appeal"}).click();
    await worker.waitForURL("**/worker/case-appeals?error=conflict",{timeout:20000});
    await worker.locator("p.status-banner[role=alert]").waitFor();
    await originalAdmin.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const originalForm=originalAdmin.getByRole("form",{name:"Review case appeal "+appealId});
    await originalForm.getByLabel("Review outcome").selectOption("accepted");
    await originalForm.getByLabel("Independent review reason").fill("The original decision maker is not allowed to review their own case appeal.");
    await originalForm.getByRole("button",{name:"Record case appeal review"}).click();
    await originalAdmin.waitForURL("**/admin/case-appeals?error=independence",{timeout:20000});
    console.log("M21303_ORIGINAL_DECISION_ADMIN_DENIED");
    const independent=await browser.newPage();await login(independent,url,second,"admin");
    await independent.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    let form=independent.getByRole("form",{name:"Review case appeal "+appealId});
    await form.getByLabel("Review outcome").selectOption("under_review");
    await form.getByLabel("Independent review reason").fill("Independent evaluation opened and original case evidence retained.");
    await form.getByRole("button",{name:"Record case appeal review"}).click();
    await independent.waitForURL("**/admin/case-appeals?status=updated",{timeout:20000});
    await independent.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    form=independent.getByRole("form",{name:"Review case appeal "+appealId});
    const stale=await browser.newPage();await stale.context().addCookies(await independent.context().cookies());
    await stale.goto(url+"/admin/case-appeals",{waitUntil:"domcontentloaded"});
    const staleForm=stale.getByRole("form",{name:"Review case appeal "+appealId});
    await form.getByLabel("Review outcome").selectOption("accepted");
    await form.getByLabel("Independent review reason").fill("Accepted after independent review. Reassessment will require a distinct policy-authorized application.");
    await form.getByRole("button",{name:"Record case appeal review"}).click();
    await independent.waitForURL("**/admin/case-appeals?status=updated",{timeout:20000});
    await staleForm.getByLabel("Review outcome").selectOption("rejected");
    await staleForm.getByLabel("Independent review reason").fill("Stale competing outcome should be rejected without modifying accepted appeal.");
    await staleForm.getByRole("button",{name:"Record case appeal review"}).click();
    await stale.waitForURL("**/admin/case-appeals?error=conflict",{timeout:20000});
    await worker.goto(url+"/worker/case-appeals",{waitUntil:"domcontentloaded"});
    const finished=worker.locator("article[id='"+appealId+"']");
    await finished.getByText("Status: accepted",{exact:false}).waitFor();
    console.log("M21303_INDEPENDENT_REVIEW_ACCEPTED_AND_STALE_DENIED");
   }finally{await browser.close()}
  }});
  const verify=new PGlite(dir);
  try{
   const appeals=(await verify.query("SELECT appeal_id,status,version,reviewer_account_id,case_id,decision_id FROM assurance_case_appeals WHERE case_id=$1",[c.caseId])).rows;
   assert.equal(appeals.length,1);assert.equal(appeals[0].status,"accepted");
   assert.equal(Number(appeals[0].version),3);assert.equal(appeals[0].reviewer_account_id,secondAccount);
   const events=(await verify.query("SELECT version,status FROM assurance_case_appeal_events WHERE appeal_id=$1 ORDER BY version",[appeals[0].appeal_id])).rows;
   assert.deepEqual(events.map(e=>[Number(e.version),e.status]),[[1,"submitted"],[2,"under_review"],[3,"accepted"]]);
   const source=(await verify.query("SELECT case_status,decision_reference,credential_reference FROM assurance_cases WHERE case_id=$1",[c.caseId])).rows[0];
   assert.equal(source.case_status,"Rejected");assert.equal(source.decision_reference,appeals[0].decision_id);assert.equal(source.credential_reference,null);
   assert.equal((await verify.query("SELECT COUNT(*)::integer AS n FROM platform_decisions WHERE case_id=$1",[c.caseId])).rows[0].n,1);
   await assert.rejects(verify.query("UPDATE assurance_case_appeal_events SET reason='tamper with immutable history' WHERE appeal_id=$1",[appeals[0].appeal_id]),/immutable/i);
   console.log("M21303_PERSISTENCE 1 appeal 3 immutable events original rejected decision unchanged");
  }finally{await verify.close()}
 }finally{await rm(root,{recursive:true,force:true})}
});