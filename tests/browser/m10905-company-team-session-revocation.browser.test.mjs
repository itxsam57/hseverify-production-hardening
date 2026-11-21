import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHmac} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";

const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret) {
  let bits="";
  for(const letter of secret.toUpperCase().replace(/=+$/g,"")) {
    const i=ALPHABET.indexOf(letter);
    assert(i>=0);bits+=i.toString(2).padStart(5,"0");
  }
  const bytes=[];
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const message=Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const mac=createHmac("sha1",Buffer.from(bytes)).update(message).digest();
  const offset=mac.at(-1)&15;
  return String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort(){
  return new Promise((resolve,reject)=>{
    const server=createServer();server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}
async function login(page,baseUrl,credential) {
  await page.goto(`${baseUrl}/company/login`,{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL(url=>url.pathname!=="/company/login",{timeout:20000});
  assert(new URL(page.url()).pathname.startsWith("/company"),"Company login did not enter Company portal");
}
async function nextTotpPeriod() {
  const remaining=30000-(Date.now()%30000)+350;
  await delay(remaining);
}

// Actual isolated signed-in Chromium forms, no mock Company update, no fixture
// schema shortcuts: first real session is permanently revoked by suspension,
// and a fresh TOTP-authenticated session is revoked by final membership revoke.
test("M1.09.05 actual Chromium owner suspends Company Team and old worker-scope session cannot reenter after reactivation",{timeout:300000},async()=>{
  const root=process.cwd();
  const workspace=await mkdtemp(join(tmpdir(),"hse-m10905-suspended-browser-"));
  const databaseDirectory=join(workspace,"db");
  const credentialsPath=join(workspace,"credentials.json");
  const baseUrl=`http://127.0.0.1:${await freePort()}`;
  const managerId="account_m10905_browser_manager";
  const managerEmail="m10905.manager@example.test";
  const managerMembership=`membership_${"B".repeat(24)}`;
  const environment={
    ...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",
    HSE_PGLITE_DATA_DIR:databaseDirectory,HSE_AUDIT_CREDENTIALS_PATH:credentialsPath,
    HSE_RELEASE_SHA:"m10905-real-company-suspend-revoke-browser",
    HSE_SESSION_SECRET:"m10905-disposable-session-secret-browser-test-00000000000000",
    HSE_AUTH_PEPPER:"m10905-disposable-pepper-browser-test-000000000000000",
    HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",
    HSE_ENABLE_AUTH_SANDBOX:"false"
  };
  try {
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]) {
      const run=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8",timeout:120000});
      assert.equal(run.status,0,`${script}: ${run.stderr||run.stdout}`);
    }
    const creds=JSON.parse(await readFile(credentialsPath,"utf8"));
    const seed=await PGlite.create(databaseDirectory);
    try {
      const ownerPassword=await seed.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[creds.company.accountId]);
      const factor=await seed.query("SELECT encrypted_secret FROM auth_mfa_factors WHERE account_id=$1 AND factor_status='active'",[creds.company.accountId]);
      assert.equal(ownerPassword.rows.length,1);assert.equal(factor.rows.length,1);
      const now=new Date().toISOString();
      await seed.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
        VALUES($1,$2,'Company Staff Session Replay Target','active',$3,$4,$4,$4,$4)`,
        [managerId,managerEmail,ownerPassword.rows[0].password_hash,now]);
      await seed.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[managerId,now]);
      await seed.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
        VALUES($1,$2,$3,'company','manager','active',$4,$5,$5,$5)`,
        [managerMembership,creds.company.tenantId,managerId,creds.company.accountId,now]);
      await seed.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
        VALUES($1,$2,'totp',$3,'active',NULL,$4,$4)`,
        [`factor_${"F".repeat(24)}`,managerId,factor.rows[0].encrypted_secret,now]);
    } finally {await seed.close();}
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
      probeUrl:`${baseUrl}/company/login`,projectRoot:root,environment,
      probe:async()=>{
        const browser=await chromium.launch({headless:true});
        const ownerContext=await browser.newContext({viewport:{width:1440,height:900}});
        const managerContext=await browser.newContext({viewport:{width:390,height:844}});
        const owner=await ownerContext.newPage();
        const manager=await managerContext.newPage();
        try {
          await login(owner,baseUrl,creds.company);
          await login(manager,baseUrl,{...creds.company,email:managerEmail});
          await manager.goto(`${baseUrl}/company/dashboard`,{waitUntil:"domcontentloaded"});
          await manager.getByRole("heading",{name:/Company|Dashboard/}).first().waitFor({timeout:20000});
          console.log("M10905_ACTUAL_CHROMIUM_MANAGER_PRE_SUSPEND_AUTHENTICATED_390PX");
          await owner.goto(`${baseUrl}/company/team`,{waitUntil:"networkidle"});
          let card=owner.locator("article").filter({hasText:"Company Staff Session Replay Target"}).first();
          await card.getByRole("button",{name:"Suspend",exact:true}).click();
          await owner.getByRole("dialog").getByRole("button",{name:"Suspend access"}).click();
          await card.getByText(/Company Team access suspended/).waitFor({timeout:18000});
          console.log("M10905_ACTUAL_CHROMIUM_OWNER_SUBMITTED_REAL_SUSPEND_FORM");
          await manager.goto(`${baseUrl}/company/dashboard`,{waitUntil:"domcontentloaded"});
          await manager.waitForURL(url=>url.pathname==="/company/login",{timeout:20000});
          console.log("M10905_ACTUAL_CHROMIUM_MANAGER_EXISTING_COOKIE_REDIRECTED_TO_LOGIN");
          await owner.reload({waitUntil:"networkidle"});
          card=owner.locator("article").filter({hasText:"Company Staff Session Replay Target"}).first();
          await card.getByRole("button",{name:"Reactivate"}).click();
          await card.getByText(/Company Team access reactivated/).waitFor({timeout:18000});
          await manager.goto(`${baseUrl}/company/dashboard`,{waitUntil:"domcontentloaded"});
          await manager.waitForURL(url=>url.pathname==="/company/login",{timeout:20000});
          console.log("M10905_ACTUAL_CHROMIUM_OLD_COOKIE_STAYS_REVOKED_AFTER_REACTIVATION");
          await nextTotpPeriod();
          await login(manager,baseUrl,{...creds.company,email:managerEmail});
          await manager.goto(`${baseUrl}/company/dashboard`,{waitUntil:"domcontentloaded"});
          await manager.getByRole("heading",{name:/Company|Dashboard/}).first().waitFor({timeout:20000});
          console.log("M10905_ACTUAL_CHROMIUM_NEW_TOTP_SESSION_ALLOWED_AFTER_REACTIVATION");
          await owner.reload({waitUntil:"networkidle"});
          card=owner.locator("article").filter({hasText:"Company Staff Session Replay Target"}).first();
          await card.getByRole("button",{name:"Revoke",exact:true}).click();
          await owner.getByRole("dialog").getByRole("button",{name:"Revoke access"}).click();
          // A revoked member is intentionally read-only: status feedback lives
          // inside canEdit and is removed with the editing forms. Verify the
          // persisted receiver-facing revoked status, not a hidden stale label.
          await card.locator(".status-pill").getByText("revoked",{exact:true}).waitFor({timeout:18000});
          await manager.goto(`${baseUrl}/company/dashboard`,{waitUntil:"domcontentloaded"});
          await manager.waitForURL(url=>url.pathname==="/company/login",{timeout:20000});
          console.log("M10905_ACTUAL_CHROMIUM_REVOKE_INVALIDATES_FRESH_COMPANY_COOKIE");
        } finally {await ownerContext.close();await managerContext.close();await browser.close();}
      }
    });
    const verify=await PGlite.create(databaseDirectory);
    try {
      const membership=await verify.query("SELECT membership_status,company_team_access_revision FROM auth_tenant_memberships WHERE membership_id=$1",[managerMembership]);
      assert.equal(membership.rows[0].membership_status,"revoked");
      assert.equal(membership.rows[0].company_team_access_revision,4);
      const sessions=await verify.query("SELECT session_id,revoked_at,revocation_reason FROM auth_sessions WHERE account_id=$1 AND active_role='company' ORDER BY created_at",[managerId]);
      assert.equal(sessions.rows.length,2);
      assert.equal(sessions.rows.every(row=>Boolean(row.revoked_at)),true);
      assert.deepEqual(sessions.rows.map(row=>row.revocation_reason).sort(),["company_team_membership_revoked","company_team_membership_suspended"].sort());
      const audit=await verify.query(`SELECT action_key FROM platform_audit_events WHERE target_reference=$1
        AND action_key IN ('company_team.membership.suspended','company_team.membership.reactivated','company_team.membership.revoked') ORDER BY audit_sequence`,[managerMembership]);
      assert.deepEqual(audit.rows.map(row=>row.action_key),[
        "company_team.membership.suspended","company_team.membership.reactivated","company_team.membership.revoked"
      ]);
      console.log("M10905_ACTUAL_CHROMIUM_REAL_DB_TWO_REVOKED_TOKENS_THREE_IMMUTABLE_TEAM_AUDITS");
    } finally {await verify.close();}
  } finally {await rm(workspace,{recursive:true,force:true});}
});
