import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret) {
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/g, "")) {
    const i = B32.indexOf(char);
    assert(i >= 0);
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i+8),2));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const mac = createHmac("sha1",Buffer.from(bytes)).update(message).digest();
  const offset = mac.at(-1)&15;
  return String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function freePort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
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
  if(credential.totpSecret) await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL(url=>url.pathname!=="/company/login",{timeout:20000});
}

test("M1.09.04 actual Chromium two Company staff stale same-role permission forms cannot resurrect revoked access", {timeout:300000}, async()=>{
  const root=process.cwd();
  const workspace=await mkdtemp(join(tmpdir(),"hse-m10904-stale-team-browser-"));
  const databaseDirectory=join(workspace,"database");
  const credentialsPath=join(workspace,"credentials.json");
  const port=await freePort();
  const baseUrl=`http://127.0.0.1:${port}`;
  const environment={
    ...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",
    HSE_PGLITE_DATA_DIR:databaseDirectory,HSE_AUDIT_CREDENTIALS_PATH:credentialsPath,
    HSE_RELEASE_SHA:"m10904-two-real-company-staff-browser",
    HSE_SESSION_SECRET:"m10904-disposable-browser-session-secret-0000000000000000000",
    HSE_AUTH_PEPPER:"m10904-disposable-browser-auth-pepper-000000000000000000",
    HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",
    HSE_ENABLE_AUTH_SANDBOX:"false"
  };
  const adminEmail="m10904.browser.admin@example.test";
  const managerEmail="m10904.browser.target@example.test";
  const adminId="account_m10904_browser_admin";
  const managerId="account_m10904_browser_manager";
  const adminMembership=`membership_${"A".repeat(24)}`;
  const managerMembership=`membership_${"B".repeat(24)}`;
  try {
    for (const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]) {
      const result=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8",timeout:120000});
      assert.equal(result.status,0,`${script}: ${result.stderr||result.stdout}`);
    }
    const creds=JSON.parse(await readFile(credentialsPath,"utf8"));
    const seed=await PGlite.create(databaseDirectory);
    try {
      const owner=await seed.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[creds.company.accountId]);
      const factor=await seed.query("SELECT encrypted_secret FROM auth_mfa_factors WHERE account_id=$1 AND factor_status='active'",[creds.company.accountId]);
      assert.equal(owner.rows.length,1);
      assert.equal(factor.rows.length,1);
      const now=new Date().toISOString();
      for (const [accountId,email,displayName,membershipId,role] of [
        [adminId,adminEmail,"M10904 Browser Company Admin",adminMembership,"admin"],
        [managerId,managerEmail,"Concurrent Team Manager",managerMembership,"manager"]
      ]) {
        await seed.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
          VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,[accountId,email,displayName,owner.rows[0].password_hash,now]);
        await seed.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[accountId,now]);
        await seed.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
          VALUES($1,$2,$3,'company',$4,'active',$5,$6,$6,$6)`,[membershipId,creds.company.tenantId,accountId,role,creds.company.accountId,now]);
      }
      await seed.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
        VALUES($1,$2,'totp',$3,'active',NULL,$4,$4)`,[`factor_${"C".repeat(24)}`,adminId,factor.rows[0].encrypted_secret,now]);
    } finally {await seed.close();}
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],
      probeUrl:`${baseUrl}/company/login`,projectRoot:root,environment,
      probe:async({output})=>{
        const browser=await chromium.launch({headless:true});
        const ownerContext=await browser.newContext({viewport:{width:1440,height:900}});
        const adminContext=await browser.newContext({viewport:{width:390,height:844}});
        const owner=await ownerContext.newPage();
        const admin=await adminContext.newPage();
        try {
          await login(owner,baseUrl,creds.company);
          await login(admin,baseUrl,{...creds.company,email:adminEmail});
          await owner.goto(`${baseUrl}/company/team`,{waitUntil:"networkidle"});
          await admin.goto(`${baseUrl}/company/team`,{waitUntil:"networkidle"});
          console.log(`M10904_BROWSER_DIAGNOSTIC_OWNER path=${new URL(owner.url()).pathname} teamCardCount=${await owner.locator("article").count()} targetText=${(await owner.locator("body").innerText()).includes("Concurrent Team Manager")} body=${JSON.stringify((await owner.locator("body").innerText()).slice(0,850))}`);
          console.log(`M10904_BROWSER_DIAGNOSTIC_ADMIN path=${new URL(admin.url()).pathname} teamCardCount=${await admin.locator("article").count()} targetText=${(await admin.locator("body").innerText()).includes("Concurrent Team Manager")} body=${JSON.stringify((await admin.locator("body").innerText()).slice(0,850))}`);
          if ((await owner.locator("article").count())===0 || (await admin.locator("article").count())===0) {
            console.log("M10904_BROWSER_OWNER_HTML",(await owner.content()).slice(0,1700));
            console.log("M10904_BROWSER_ADMIN_HTML",(await admin.content()).slice(0,1700));
            console.log("M10904_BROWSER_DEV_SERVER_LOG",output().slice(-2800));
            throw new Error("Company Team routes rendered without any member card; preserve source diagnostics, not a browser PASS");
          }
          const ownerCard=owner.locator("article").filter({hasText:"Concurrent Team Manager"}).first();
          const adminCard=admin.locator("article").filter({hasText:"Concurrent Team Manager"}).first();
          await ownerCard.getByRole("button",{name:"Save Team access"}).waitFor();
          await adminCard.getByRole("button",{name:"Save Team access"}).waitFor();
          const ownerRevision=await ownerCard.locator('input[name="expectedAccessRevision"]').inputValue();
          const adminRevision=await adminCard.locator('input[name="expectedAccessRevision"]').inputValue();
          assert.equal(ownerRevision,"1");
          assert.equal(adminRevision,"1");
          await ownerCard.locator('input[name="permissions"][value="company.workforce.manage"]').uncheck();
          await ownerCard.getByRole("button",{name:"Save Team access"}).click();
          await ownerCard.getByText(/Company Team role, permissions and unit scope saved/).waitFor({timeout:18000});
          console.log("M10904_ACTUAL_CHROMIUM_OWNER_REVOKED_WORKFORCE_PERMISSION");
          // Admin's *unrefreshed* real 390px form is still revision 1.
          assert.equal(await adminCard.locator('input[name="expectedAccessRevision"]').inputValue(),"1");
          assert.equal(await adminCard.locator('input[name="permissions"][value="company.workforce.manage"]').isChecked(),true);
          await adminCard.getByRole("button",{name:"Save Team access"}).click();
          await adminCard.getByText(/That Company Team membership changed\. Reload and try again/).waitFor({timeout:18000});
          console.log("M10904_ACTUAL_CHROMIUM_STALE_ADMIN_FORM_CONFLICT_390PX");
          await admin.reload({waitUntil:"networkidle"});
          const currentCard=admin.locator("article").filter({hasText:"Concurrent Team Manager"}).first();
          assert.equal(await currentCard.locator('input[name="expectedAccessRevision"]').inputValue(),"2");
          assert.equal(await currentCard.locator('input[name="permissions"][value="company.workforce.manage"]').isChecked(),false);
          await currentCard.locator('input[name="permissions"][value="company.workforce.manage"]').check();
          await currentCard.getByRole("button",{name:"Save Team access"}).click();
          await currentCard.getByText(/Company Team role, permissions and unit scope saved/).waitFor({timeout:18000});
          console.log("M10904_ACTUAL_CHROMIUM_FRESH_ADMIN_VERSION2_AUTHORIZED_GRANT");
          await owner.reload({waitUntil:"networkidle"});
          const freshOwnerCard=owner.locator("article").filter({hasText:"Concurrent Team Manager"}).first();
          assert.equal(await freshOwnerCard.locator('input[name="expectedAccessRevision"]').inputValue(),"3");
          assert.equal(await freshOwnerCard.locator('input[name="permissions"][value="company.workforce.manage"]').isChecked(),true);
          console.log("M10904_ACTUAL_CHROMIUM_OWNER_RECEIVES_FRESH_ADMIN_STATE_RELOAD");
        } finally {
          await ownerContext.close();await adminContext.close();await browser.close();
        }
      }
    });
    const check=await PGlite.create(databaseDirectory);
    try {
      const member=await check.query("SELECT company_team_access_revision,membership_role,membership_status FROM auth_tenant_memberships WHERE membership_id=$1",[managerMembership]);
      assert.equal(member.rows[0].company_team_access_revision,3);
      assert.equal(member.rows[0].membership_role,"manager");
      assert.equal(member.rows[0].membership_status,"active");
      const audits=await check.query(`SELECT actor_account_id FROM platform_audit_events WHERE action_key='company_team.membership.updated' AND target_reference=$1 ORDER BY audit_sequence`,[managerMembership]);
      assert.deepEqual(audits.rows.map(row=>row.actor_account_id),[creds.company.accountId,adminId],"Only successful Owner and refreshed Admin Team updates may be audited");
      console.log("M10904_ACTUAL_CHROMIUM_PERSISTED_DB_REVISION3_AND_TWO_ACTOR_AUDITS");
    } finally {await check.close();}
  } finally {await rm(workspace,{recursive:true,force:true});}
});
