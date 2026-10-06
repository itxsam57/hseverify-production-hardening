import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";



const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode32(value) {
  let bits = 0, acc = 0;
  const bytes = [];
  for (const char of value.toUpperCase().replace(/=+$/g, "")) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
      acc &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}
function totp(secret, stepOffset = 0) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const digest = createHmac("sha1", decode32(secret)).update(message).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("Could not allocate port."));
        else resolve(address.port);
      });
    });
  });
}
const SANDBOX_KEY = "duplicate-recovery-test-sandbox-key-2026";
test("Company registration commits email/MFA denials and activates only a Company owner in a pending tenant", {timeout:180000}, async()=>{
 const root=process.cwd(), directory=await mkdtemp(join(tmpdir(),"hse-company-registration-"));
 const port=await freePort(),baseUrl="http://127.0.0.1:"+port,email="company.boundary@example.test";
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,HSE_RELEASE_SHA:"company-registration-browser",
 HSE_SESSION_SECRET:"company-registration-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"company-registration-pepper-more-than-thirty-two",HSE_ENABLE_AUTH_SANDBOX:"true",HSE_AUTH_SANDBOX_ACCESS_KEY:SANDBOX_KEY,HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 let browser, code, setupKey, issuedAt;
 try{
  const r=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);
  browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage(),inbox=await context.newPage();
  async function phase(probe){await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/company/login",projectRoot:root,environment,probe});}
  await phase(async()=>{
   await page.goto(baseUrl+"/company/register");
   for(const [label,value] of [["Legal Company name","Boundary Safety Limited"],["Trading name","Boundary Safety"],["Registration number","COMPANY-BOUNDARY-2026"],["Registration country","Pakistan"],["Industry","Safety services"],["Company website","https://boundary.example.test"],["Authorized representative","Company Boundary QA"],["Business email",email],["Business phone","+923001224499"],["Create password","CompanyBoundary!Password2026"],["Confirm password","CompanyBoundary!Password2026"]]) await page.getByLabel(label,{exact:true}).fill(value);
   await page.getByLabel("Company size").selectOption("11-50");
   await page.getByLabel("I accept the HSE Verify terms for this Company application.").check();
   await page.getByLabel("I accept the privacy notice for Company verification data and evidence.").check();
   await page.getByRole("button",{name:"Create Company application",exact:true}).click();
   await page.waitForURL("**/company/register/verify");await page.getByText("Step 1 of 2",{exact:true}).waitFor();
   await inbox.goto(baseUrl+"/company/register/sandbox");
   await inbox.getByLabel("Business email").fill(email);await inbox.getByLabel("Sandbox access key").fill(SANDBOX_KEY);
   await inbox.getByRole("button",{name:"Open latest email code",exact:true}).click();
   const status=inbox.getByRole("status",{name:"Latest Company registration code"});await status.waitFor();
   code=(await status.locator("strong").innerText()).trim();issuedAt=Date.now();
   await page.getByRole("button",{name:"Send new code",exact:true}).click();
   await page.waitForURL("**/company/register/verify?reason=cooldown");
   await page.getByRole("alert").getByText("Wait before requesting another verification code.",{exact:true}).waitFor({timeout:5000});

   await page.getByLabel("Email verification code").fill(String((Number(code)+1)%1000000).padStart(6,"0"));
   await page.getByRole("button",{name:"Verify business email",exact:true}).click();
   await page.getByRole("alert").getByText("The verification code is incorrect. 4 attempts remaining.",{exact:true}).waitFor();
   console.log("ACTUAL_COMPANY_EMAIL_REJECTION_BROWSER: wrong code denied with four attempts remaining");
   for(let remaining=3;remaining>=0;remaining--){
    await page.getByLabel("Email verification code").fill(String((Number(code)+1)%1000000).padStart(6,"0"));
    await page.getByRole("button",{name:"Verify business email",exact:true}).click();
    const message=remaining>0?`The verification code is incorrect. ${remaining} attempt${remaining===1?"":"s"} remaining.`:"That verification code can no longer be used. Request a new code.";
    await page.getByRole("alert").getByText(message,{exact:true}).waitFor();
   }
   await page.getByLabel("Email verification code").fill(code);
   await page.getByRole("button",{name:"Verify business email",exact:true}).click();
   await page.getByRole("alert").getByText("Request a new Company email verification code.",{exact:true}).waitFor();
   await page.getByText("Step 1 of 2",{exact:true}).waitFor();
   console.log("ACTUAL_COMPANY_EXHAUSTION_BROWSER: five rejected codes, correct exhausted code denied");

  });
  const db=new PGlite(directory);try{
   const a=(await db.query("SELECT account_id,account_status,email_verified_at FROM auth_accounts WHERE email_normalized=$1",[email])).rows[0];
   assert.equal(a.account_status,"pending_email");assert.equal(a.email_verified_at,null);
   const flow=(await db.query("SELECT current_step,tenant_id,membership_id FROM company_registration_flows WHERE account_id=$1",[a.account_id])).rows[0];assert.equal(flow.current_step,"pending_email");
   assert.equal((await db.query("SELECT tenant_status FROM platform_tenants WHERE tenant_id=$1",[flow.tenant_id])).rows[0].tenant_status,"pending");
   assert.equal((await db.query("SELECT membership_status FROM auth_tenant_memberships WHERE membership_id=$1",[flow.membership_id])).rows[0].membership_status,"invited");
   assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1",[a.account_id])).rows[0].count,0);
   assert.equal((await db.query("SELECT attempts_remaining FROM auth_otp_challenges WHERE account_id=$1",[a.account_id])).rows[0].attempts_remaining,0);
   assert.equal((await db.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.otp.failed'",[a.account_id])).rows[0].count,5);
   console.log("ACTUAL_COMPANY_EMAIL_REJECTION_DB: pending foundations, no session, committed decrement and immutable audit");
  }finally{await db.close();}

  await page.close();
  let verifyPage;
  await phase(async()=>{
   verifyPage=await context.newPage();await verifyPage.goto(baseUrl+"/company/register/verify");
   await verifyPage.waitForTimeout(Math.max(0,65000-(Date.now()-issuedAt)));
   await verifyPage.getByRole("button",{name:"Send new code",exact:true}).click();
   await verifyPage.waitForURL("**/company/register/verify?reason=resent");
   await inbox.goto(baseUrl+"/company/register/sandbox");await inbox.getByLabel("Business email").fill(email);await inbox.getByLabel("Sandbox access key").fill(SANDBOX_KEY);await inbox.getByRole("button",{name:"Open latest email code",exact:true}).click();
   const latest=inbox.getByRole("status",{name:"Latest Company registration code"});await latest.waitFor();code=(await latest.locator("strong").innerText()).trim();

   await verifyPage.getByLabel("Email verification code").fill(code);
   await verifyPage.getByRole("button",{name:"Verify business email",exact:true}).click();
   await verifyPage.getByText("Step 2 of 2",{exact:true}).waitFor();
   setupKey=(await verifyPage.locator("code").innerText()).trim();
   await verifyPage.getByLabel("Authenticator code").fill(["000000","111111","222222","333333"].find(c=>![-1,0,1].map(o=>totp(setupKey,o)).includes(c)));
   await verifyPage.getByRole("button",{name:"Activate Company account",exact:true}).click();
   await verifyPage.getByRole("alert").getByText("The authenticator code is invalid or was already used.",{exact:true}).waitFor();
   console.log("ACTUAL_COMPANY_MFA_REJECTION_BROWSER: invalid authenticator denied after verified email");
  });
  await verifyPage.close();
  const mfaDb=new PGlite(directory);try{
   const a=(await mfaDb.query("SELECT account_id,account_status,email_verified_at FROM auth_accounts WHERE email_normalized=$1",[email])).rows[0];
   assert.ok(a.email_verified_at);
   assert.equal((await mfaDb.query("SELECT current_step FROM company_registration_flows WHERE account_id=$1",[a.account_id])).rows[0].current_step,"pending_mfa");
   assert.equal((await mfaDb.query("SELECT factor_status FROM auth_mfa_factors WHERE account_id=$1",[a.account_id])).rows[0].factor_status,"pending");
   assert.equal((await mfaDb.query("SELECT count(*)::int AS count FROM auth_sessions WHERE account_id=$1",[a.account_id])).rows[0].count,0);
   assert.equal((await mfaDb.query("SELECT count(*)::int AS count FROM platform_audit_events WHERE actor_account_id=$1 AND action_key='authentication.mfa.failed'",[a.account_id])).rows[0].count,1);
   console.log("ACTUAL_COMPANY_MFA_REJECTION_DB: pending factor/flow, no session and committed immutable audit");
  }finally{await mfaDb.close();}
  await phase(async()=>{
   const finalPage=await context.newPage();await finalPage.goto(baseUrl+"/company/register/verify");
   await finalPage.getByLabel("Authenticator code").fill(totp(setupKey));
   await finalPage.getByRole("button",{name:"Activate Company account",exact:true}).click();
   await finalPage.waitForURL("**/company/login?reason=registration-complete");
   await finalPage.getByLabel("Email address").fill(email);await finalPage.getByLabel("Password",{exact:true}).fill("CompanyBoundary!Password2026");
   await finalPage.getByLabel("Authenticator code").fill(totp(setupKey,1));
   await finalPage.getByRole("button",{name:"Sign in",exact:true}).click();
   await finalPage.waitForURL("**/company/dashboard");
   await finalPage.getByRole("link",{name:"Open Company verification",exact:true}).waitFor();
   await finalPage.goto(baseUrl+"/company/settings/profile");
   await finalPage.getByRole("heading",{name:"Draft",exact:true}).waitFor();
   console.log("ACTUAL_COMPANY_ACTIVATION_BROWSER: verified email and enrolled MFA allow Company login to pending verification draft");
  });
  const finalDb=new PGlite(directory);try{
   const a=(await finalDb.query("SELECT account_id,account_status,email_verified_at FROM auth_accounts WHERE email_normalized=$1",[email])).rows[0];assert.equal(a.account_status,"active");
   const f=(await finalDb.query("SELECT current_step,completed_at,tenant_id,membership_id FROM company_registration_flows WHERE account_id=$1",[a.account_id])).rows[0];assert.equal(f.current_step,"complete");assert.ok(f.completed_at);
   assert.equal((await finalDb.query("SELECT tenant_status FROM platform_tenants WHERE tenant_id=$1",[f.tenant_id])).rows[0].tenant_status,"pending");
   assert.deepEqual((await finalDb.query("SELECT membership_status,membership_role,portal_role,account_id,tenant_id FROM auth_tenant_memberships WHERE membership_id=$1",[f.membership_id])).rows,[{membership_status:"active",membership_role:"owner",portal_role:"company",account_id:a.account_id,tenant_id:f.tenant_id}]);
   assert.deepEqual((await finalDb.query("SELECT role FROM auth_account_roles WHERE account_id=$1",[a.account_id])).rows,[{role:"company"}]);
   const sessions=(await finalDb.query("SELECT active_role,revoked_at FROM auth_sessions WHERE account_id=$1",[a.account_id])).rows;assert.deepEqual(sessions,[{active_role:"company",revoked_at:null}]);
   assert.equal((await finalDb.query("SELECT factor_status FROM auth_mfa_factors WHERE account_id=$1",[a.account_id])).rows[0].factor_status,"active");
   const challenge=(await finalDb.query("SELECT attempts_remaining,consumed_at FROM auth_otp_challenges WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1",[a.account_id])).rows[0];assert.equal(challenge.attempts_remaining,5);assert.ok(challenge.consumed_at);
   console.log("ACTUAL_COMPANY_ACTIVATION_DB: exact Company role/session, active owner/factor and completed flow; tenant still pending");
  }finally{await finalDb.close();}

 }finally{if(browser)await browser.close();await rm(directory,{recursive:true,force:true});}
});
