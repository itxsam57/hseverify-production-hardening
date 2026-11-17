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

// The actor's *own* permission changes while its stale 390px form is open:
// unlike M1.09.04, the target Manager access revision never changed.
test("M1.09.06 actual Chromium Owner removes Admin live grant while stale Admin Manager and invitation forms cannot delegate it",{timeout:300000},async()=>{
  const root=process.cwd();
  const workspace=await mkdtemp(join(tmpdir(),"hse-m10906-live-ceiling-ui-"));
  const dbDir=join(workspace,"db");
  const credentialsPath=join(workspace,"credentials.json");
  const baseUrl=`http://127.0.0.1:${await freePort()}`;
  const adminId="account_m10906_browser_admin", managerId="account_m10906_browser_manager";
  const adminEmail="m10906.browser.admin@example.test",managerEmail="m10906.browser.manager@example.test";
  const adminMembership=`membership_${"A".repeat(24)}`,managerMembership=`membership_${"B".repeat(24)}`;
  const environment={
    ...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",
    HSE_PGLITE_DATA_DIR:dbDir,HSE_AUDIT_CREDENTIALS_PATH:credentialsPath,
    HSE_RELEASE_SHA:"m10906-owner-admin-current-ceiling-ui",
    HSE_SESSION_SECRET:"m10906-company-owner-admin-live-ceiling-session-0000000000",
    HSE_AUTH_PEPPER:"m10906-company-owner-admin-live-ceiling-pepper-0000000000",
    HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",
    HSE_ENABLE_AUTH_SANDBOX:"false"
  };
  try {
    for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
      const result=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8",timeout:120000});
      assert.equal(result.status,0,`${script}: ${result.stderr||result.stdout}`);
    }
    const credentials=JSON.parse(await readFile(credentialsPath,"utf8"));
    const seed=await PGlite.create(dbDir);
    try {
      const ownerPassword=await seed.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[credentials.company.accountId]);
      const ownerFactor=await seed.query("SELECT encrypted_secret FROM auth_mfa_factors WHERE account_id=$1 AND factor_status='active'",[credentials.company.accountId]);
      assert.equal(ownerPassword.rows.length,1);assert.equal(ownerFactor.rows.length,1);
      const now=new Date().toISOString();
      for(const [accountId,email,name,membershipId,role] of [
        [adminId,adminEmail,"M10906 Browser Company Admin",adminMembership,"admin"],
        [managerId,managerEmail,"Live Ceiling Target Manager",managerMembership,"manager"]
      ]){
        await seed.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
          VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,[accountId,email,name,ownerPassword.rows[0].password_hash,now]);
        await seed.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[accountId,now]);
        await seed.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
          VALUES($1,$2,$3,'company',$4,'active',$5,$6,$6,$6)`,
          [membershipId,credentials.company.tenantId,accountId,role,credentials.company.accountId,now]);
      }
      await seed.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
        VALUES($1,$2,'totp',$3,'active',NULL,$4,$4)`,
        [`factor_${"C".repeat(24)}`,adminId,ownerFactor.rows[0].encrypted_secret,now]);
    } finally {await seed.close();}
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
      probeUrl:`${baseUrl}/company/login`,projectRoot:root,environment,
      probe:async()=>{
        const browser=await chromium.launch({headless:true});
        const ownerContext=await browser.newContext({viewport:{width:1440,height:900}});
        const adminContext=await browser.newContext({viewport:{width:390,height:844}});
        const owner=await ownerContext.newPage();
        const admin=await adminContext.newPage();
        try {
          await login(owner,baseUrl,credentials.company);
          await login(admin,baseUrl,{...credentials.company,email:adminEmail});
          await owner.goto(`${baseUrl}/company/team`,{waitUntil:"networkidle"});
          await admin.goto(`${baseUrl}/company/team`,{waitUntil:"networkidle"});
          const ownerAdminCard=owner.locator("article").filter({hasText:"M10906 Browser Company Admin"}).first();
          const staleAdminManagerCard=admin.locator("article").filter({hasText:"Live Ceiling Target Manager"}).first();
          await ownerAdminCard.getByRole("button",{name:"Save Team access"}).waitFor();
          await staleAdminManagerCard.getByRole("button",{name:"Save Team access"}).waitFor();
          assert.equal(await staleAdminManagerCard.locator('input[name="expectedAccessRevision"]').inputValue(),"1");
          assert.equal(await staleAdminManagerCard.locator('input[name="permissions"][value="company.workforce.manage"]').isChecked(),true);
          const staleInvite=admin.getByRole("button",{name:"Create Company Team invitation"});
          await staleInvite.waitFor();
          await ownerAdminCard.locator('input[name="permissions"][value="company.workforce.manage"]').uncheck();
          await ownerAdminCard.getByRole("button",{name:"Save Team access"}).click();
          await ownerAdminCard.getByText(/Company Team role, permissions and unit scope saved/).waitFor({timeout:18000});
          console.log("M10906_ACTUAL_CHROMIUM_OWNER_REMOVES_ADMIN_WORKFORCE_GRANT_DESKTOP");
          // The Admin's role is still admin and the target's access revision
          // stays 1; only its live permission authority has changed.
          assert.equal(await staleAdminManagerCard.locator('input[name="expectedAccessRevision"]').inputValue(),"1");
          await staleAdminManagerCard.getByRole("button",{name:"Save Team access"}).click();
          await staleAdminManagerCard.getByText(/Your current Company role cannot complete that Team change/).waitFor({timeout:18000});
          console.log("M10906_ACTUAL_CHROMIUM_390PX_STALE_ADMIN_MANAGER_FORM_GRANT_CEILING_DENIED");
          await admin.getByLabel("Staff email").fill("m10906.forbidden.invite@example.test");
          await staleInvite.click();
          await admin.getByText(/Your current Company role cannot complete that Team change/).first().waitFor({timeout:18000});
          console.log("M10906_ACTUAL_CHROMIUM_390PX_STALE_ADMIN_INVITATION_GRANT_CEILING_DENIED");
          await admin.reload({waitUntil:"networkidle"});
          const currentManagerCard=admin.locator("article").filter({hasText:"Live Ceiling Target Manager"}).first();
          await currentManagerCard.getByRole("button",{name:"Save Team access"}).waitFor();
          assert.equal(await currentManagerCard.locator('input[name="permissions"][value="company.workforce.manage"]').count(),0,
            "Refreshed 390px Admin may not offer a grant above its live permission ceiling");
          assert.equal(await admin.locator('fieldset input[name="permissions"][value="company.workforce.manage"]').count(),0);
          assert.equal(await admin.locator('select[name="membershipRole"] option[value="owner"]').count(),0);
          await currentManagerCard.getByRole("button",{name:"Save Team access"}).click();
          await currentManagerCard.getByText(/Company Team role, permissions and unit scope saved/).waitFor({timeout:18000});
          assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,
            "390px Admin Team form unexpectedly causes horizontal overflow");
          await owner.reload({waitUntil:"networkidle"});
          const receivedManager=owner.locator("article").filter({hasText:"Live Ceiling Target Manager"}).first();
          assert.equal(await receivedManager.locator('input[name="permissions"][value="company.workforce.manage"]').isChecked(),false);
          console.log("M10906_ACTUAL_CHROMIUM_REFRESHED_ADMIN_ONLY_SEES_OWN_CEILING_AND_OWNER_RECEIVES_NARROW_MANAGER");
        } finally {await ownerContext.close();await adminContext.close();await browser.close();}
      }
    });
    const db=await PGlite.create(dbDir);
    try {
      const r=await db.query(`SELECT membership_id,company_team_access_revision FROM auth_tenant_memberships
        WHERE membership_id IN ($1,$2) ORDER BY membership_id`,[adminMembership,managerMembership]);
      assert.equal(r.rows.length,2);
      assert.deepEqual(r.rows.map(x=>Number(x.company_team_access_revision)),[2,2]);
      const overrides=await db.query(`SELECT membership_id FROM auth_tenant_permission_overrides
        WHERE permission_key='company.workforce.manage' AND effect='deny'
          AND membership_id IN ($1,$2) ORDER BY membership_id`,[adminMembership,managerMembership]);
      assert.deepEqual(overrides.rows.map(row=>row.membership_id),[adminMembership,managerMembership]);
      const forged=await db.query("SELECT 1 FROM auth_staff_invitations WHERE email_normalized='m10906.forbidden.invite@example.test'");
      assert.equal(forged.rows.length,0);
      const audits=await db.query(`SELECT actor_account_id,target_reference FROM platform_audit_events
        WHERE action_key='company_team.membership.updated' AND target_reference IN ($1,$2)
        ORDER BY audit_sequence`,[adminMembership,managerMembership]);
      assert.deepEqual(audits.rows.map(x=>[x.actor_account_id,x.target_reference]),[
        [credentials.company.accountId,adminMembership],[adminId,managerMembership]
      ]);
      console.log("M10906_ACTUAL_CHROMIUM_DB_ONLY_TWO_AUTHORIZED_TEAM_MUTATIONS_NO_FORGED_INVITE_EXACT_AUDIT");
    } finally {await db.close();}
  } finally {await rm(workspace,{recursive:true,force:true});}
});
