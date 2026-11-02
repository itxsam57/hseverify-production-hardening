import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const ORDER="assurance_order_"+"K".repeat(24);
const TARGETS=["assurance_target_"+"L".repeat(24),"assurance_target_"+"M".repeat(24)];
const CASES=["assurance_case_"+"N".repeat(24),"assurance_case_"+"O".repeat(24)];
const DENIAL="This Assurance Order has finalized Worker decisions or credentials and cannot be cancelled.";

function totp(secret) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits=[...secret.toUpperCase()].map(c=>alphabet.indexOf(c).toString(2).padStart(5,"0")).join("");
  const bytes=Buffer.from(Array.from({length:Math.floor(bits.length/8)},(_,i)=>parseInt(bits.slice(i*8,i*8+8),2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",bytes).update(counter).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const port=server.address().port;server.close(error=>error?reject(error):resolve(port));
    });
  });
}

test("Company cannot cancel partially finalized order or hide an approved Worker case", {timeout:180000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"hse-company-finalized-cancel-"));
  const credentialPath=join(dir,"seed-credentials.json");
  const environment={...process.env,
    HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,
    HSE_AUDIT_CREDENTIALS_PATH:credentialPath,HSE_RELEASE_SHA:"cancel-approved-browser",
    HSE_SESSION_SECRET:"cancel-approved-browser-secret-2026-very-long",
    HSE_AUTH_PEPPER:"cancel-approved-browser-pepper-2026-very-long",
    HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"
  };
  const root=process.cwd(),port=await freePort(),base="http://127.0.0.1:"+port;
  let tenantId;
  try {
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]) {
      const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});
      assert.equal(r.status,0,r.stderr||r.stdout);
    }
    const credentials=JSON.parse(await readFile(credentialPath,"utf8"));
    const database=new PGlite(dir);
    try {
      const membership=(await database.query(
        "SELECT membership_id,tenant_id FROM auth_tenant_memberships WHERE account_id=$1 AND portal_role='company' AND membership_status='active'",
        [credentials.company.accountId]
      )).rows[0];
      assert.ok(membership,"Seed did not create a live Company membership");
      tenantId=membership.tenant_id;
      const second="worker_cancel_20261030_second";
      const timestamp=new Date().toISOString();
      await database.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
        SELECT $1,'cancel.second@example.test','Second Worker','active',password_hash,$2,$2,$2,$2 FROM auth_accounts WHERE account_id=$3`,
        [second,timestamp,credentials.worker.accountId]);
      await database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[second,timestamp]);
      await database.query(`INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,order_status,submitted_at,created_at,updated_at)
        VALUES($1,$2,$3,'Partly finalized Work Order','PARTIAL-DECISION-CANCEL','ACTIVE',$4,$4,$4)`,[ORDER,tenantId,membership.membership_id,timestamp]);
      for(const [i,accountId] of [credentials.worker.accountId,second].entries()) {
        const link="company_worker_link_"+String(i+1).repeat(24);
        await database.query(`INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,'company','submitted',$6,$6)`,
          [TARGETS[i],ORDER,tenantId,link,accountId,timestamp]);
        await database.query(`INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,decision_reference,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
          [CASES[i],ORDER,TARGETS[i],tenantId,link,accountId,i===0?"Approved":"Assessment pending",i===0?null:"worker",i===0?null:"Complete assessment",i===0?"decision_finalized_worker":null,timestamp]);
      }
    } finally {await database.close();}
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base+"/company/login",
      projectRoot:root,environment,probe:async()=>{
        const browser=await chromium.launch({headless:true});
        try {
          const page=await browser.newPage();
          await page.goto(base+"/company/login");
          await page.getByLabel("Email address").fill(credentials.company.email);
          await page.getByLabel("Password").fill(credentials.company.password);
          await page.getByLabel("Authenticator code").fill(totp(credentials.company.totpSecret));
          await page.getByRole("button",{name:"Sign in",exact:true}).click();
          await page.waitForURL("**/company/dashboard");
          await page.goto(base+"/company/assurance-orders/"+ORDER);
          await page.getByText("PARTIAL-DECISION-CANCEL").first().waitFor();
          const approved=page.locator("tr[id='"+CASES[0]+"']");
          const pending=page.locator("tr[id='"+CASES[1]+"']");
          await approved.getByText("Approved",{exact:true}).waitFor();
          await pending.getByText("Assessment pending",{exact:true}).waitFor();
          await page.getByRole("button",{name:"Cancel Submitted Order",exact:true}).click();
          await page.getByRole("alert").getByText(DENIAL,{exact:true}).waitFor();
          assert.equal(new URL(page.url()).pathname,"/company/assurance-orders/"+ORDER);
          await approved.getByText("Approved",{exact:true}).waitFor();
          await pending.getByText("Assessment pending",{exact:true}).waitFor();
          console.log("ACTUAL_COMPANY_CANCEL_DECISION_BROWSER denied with inline reason; approved Worker and sibling remain visible");
        } finally {await browser.close();}
      }
    });
    const verify=new PGlite(dir);
    try {
      assert.equal((await verify.query("SELECT order_status FROM assurance_orders WHERE order_id=$1",[ORDER])).rows[0].order_status,"ACTIVE");
      const cases=(await verify.query("SELECT case_id,case_status,decision_reference FROM assurance_cases WHERE order_id=$1 ORDER BY case_id",[ORDER])).rows;
      assert.deepEqual(cases.map(row=>row.case_status),["Approved","Assessment pending"]);
      assert.equal(cases[0].decision_reference,"decision_finalized_worker");
      assert.equal((await verify.query("SELECT COUNT(*)::int AS n FROM assurance_case_timeline_events WHERE order_id=$1 AND event_type IN ('case_cancelled','order_cancelled')",[ORDER])).rows[0].n,0);
      console.log("ACTUAL_COMPANY_CANCEL_DECISION_DB preserved ACTIVE Company order, approved decision, second Worker and zero cancellation audit/timeline events");
    } finally {await verify.close();}
  } finally {await rm(dir,{recursive:true,force:true});}
});
