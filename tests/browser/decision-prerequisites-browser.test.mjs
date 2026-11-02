import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
const port=()=>new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p))})});
function totp(secret){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";const bits=[...secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac("sha1",Buffer.from(bytes)).update(b).digest();const o=h.at(-1)&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,"0")}
async function seed(db,kind){
 const tenant="tenant_aaaaaaaaaaaaaaaaaaaaaaaa",suffix=kind==="assessment"?"b":"c",order="assurance_order_"+suffix.repeat(24),target="assurance_target_"+suffix.repeat(24),caseId="assurance_case_"+suffix.repeat(24);
 const now="2026-09-25T10:00:00.000Z",framework=kind==="assessment"?JSON.stringify(["mandatory-framework"]):"[]",interview=kind==="interview";
 await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,credential_target,assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,'membership_acceptance_owner',$3,$4,NULL,$5::jsonb,$6,'SUBMITTED',$7,$7,$7)",[order,tenant,kind+" pending decision",kind+"-PREREQUISITE-2026",framework,interview,now]);
 await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,'worker_link_acceptance_01','worker_account_acceptance_01','worker_id_acceptance_000001','company','submitted',$4,$4)",[target,order,tenant,now]);
 await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,'worker_link_acceptance_01','worker_account_acceptance_01','worker_id_acceptance_000001','Decision pending','admin','Record final decision.',$5,$5)",[caseId,order,target,tenant,now]);
 return {tenant,caseId,kind};
}
test("M2.13.01 Admin browser shows required missing stages; no decision is persisted",{timeout:220000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"hse-m21301-ui-")),creds=join(dir,"credentials.json"),number=await port(),url="http://127.0.0.1:"+number;
 const env={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,HSE_AUDIT_CREDENTIALS_PATH:creds,HSE_RELEASE_SHA:"m21301-admin-browser",HSE_SESSION_SECRET:"m21301-session-test-secret-2026-32chars",HSE_AUTH_PEPPER:"m21301-auth-pepper-test-2026-32chars",HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 try{
  for(const file of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[file],{env,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout)}
  const {admin}=JSON.parse(await readFile(creds,"utf8"));
  const db=new PGlite(dir);let scopes;try{scopes=[await seed(db,"assessment"),await seed(db,"interview")]}finally{await db.close()}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(number)],probeUrl:url+"/admin/login",projectRoot:process.cwd(),environment:env,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try {
    const page=await browser.newPage();
    await page.goto(url+"/admin/login");await page.getByLabel("Email address").fill(admin.email);await page.getByLabel("Password",{exact:true}).fill(admin.password);await page.getByLabel("Authenticator code").fill(totp(admin.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/admin/dashboard",{timeout:30000});
    for (const scope of scopes){
     await page.goto(url+"/admin/decisions?tenantId="+scope.tenant+"&caseId="+scope.caseId);
     const form=page.locator("form").filter({has:page.getByRole("button",{name:"Create decision",exact:true})});
     await form.locator("[name=state]").selectOption("APPROVED");
     await form.getByLabel("Reason code").fill("all_stages_passed");
     await form.getByLabel("Explanation").fill("Claims stages completed even though required result is missing.");
     await form.getByLabel("Rule version").fill("m21301-browser-v1");
     await form.getByLabel("Input references").fill("untrusted-claim");
     await form.getByRole("button",{name:"Create decision",exact:true}).click();
     const alert=page.locator(".status-banner.status-error");await alert.waitFor({timeout:20000});
     const message=(await alert.innerText()).trim();
     console.log("M21301_"+scope.kind+"_UI_ALERT:",message);
     assert.match(message,scope.kind==="assessment"?/Required assessment has no completed passing result/i:/Required interview has no completed passing recommendation/i,"Admin needs an actionable safe rejection message");
    }
   } finally{await browser.close()}
  }});
  const db2=new PGlite(dir);try{for(const s of scopes){const q=await db2.query("SELECT case_status,decision_reference FROM assurance_cases WHERE case_id=$1",[s.caseId]);assert.equal(q.rows[0].case_status,"Decision pending");assert.equal(q.rows[0].decision_reference,null);const d=await db2.query("SELECT decision_id FROM platform_decisions WHERE case_id=$1",[s.caseId]);assert.equal(d.rows.length,0)}}finally{await db2.close()}
 }finally{await rm(dir,{recursive:true,force:true})}
});