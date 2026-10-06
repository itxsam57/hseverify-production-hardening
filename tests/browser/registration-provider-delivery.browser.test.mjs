import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHmac} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "../helpers/worker-registration-runtime-loader.mjs";
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
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

test("Non-sandbox Worker email/SMS and Company email use real queued delivery and browser verification", {timeout:240000},async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"hse-provider-browser-")),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const pepper="provider-browser-auth-pepper-more-than-thirty-two";
 const providers={emailApiKey:"fixture-email-key",emailFrom:"verify@example.test",smsAccountSid:"AC"+"a".repeat(32),smsAuthToken:"fixture-sms-token",smsFrom:"+15550001111"};
 const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,
  HSE_RELEASE_SHA:"provider-browser",HSE_SESSION_SECRET:"provider-browser-session-secret-more-than-thirty-two",
  HSE_AUTH_PEPPER:pepper,HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",
  HSE_OTP_EMAIL_API_KEY:providers.emailApiKey,HSE_OTP_EMAIL_FROM:providers.emailFrom,
  HSE_OTP_SMS_ACCOUNT_SID:providers.smsAccountSid,HSE_OTP_SMS_AUTH_TOKEN:providers.smsAuthToken,HSE_OTP_SMS_FROM:providers.smsFrom};
 const dbEnvironment={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:directory,
  releaseSha:"provider-browser",sessionSecret:environment.HSE_SESSION_SECRET,authPepper:pepper,
  authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false,registrationOtpProviders:providers};
 setWorkerRegistrationRuntimeEnvironment(dbEnvironment);
 let browser;
 async function phase(probe){await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment,probe});}
 async function delivery(channel,destination){
  // Each browser server phase is stopped before opening the PGlite worker connection.
  const db=await openScriptDatabase(dbEnvironment);const old=globalThis.fetch;let code,calls=0;
  globalThis.fetch=async(endpoint,options)=>{
   calls++;const message=channel==="email"?JSON.parse(options.body).text:new URLSearchParams(options.body).get("Body");
   const target=channel==="email"?JSON.parse(options.body).to[0]:new URLSearchParams(options.body).get("To");
   assert.equal(target,destination);code=message.match(/code is ([0-9]{6})/)[1];
   assert.ok(endpoint.startsWith(channel==="email"?"https://api.resend.com/":"https://api.twilio.com/"));
   return new Response(JSON.stringify(channel==="email"?{id:"browser-accepted"}:{sid:"SM"+"c".repeat(32)}),{status:200});
  };
  try{
   const job=await processNextOutboxJob({repository:new DatabaseOutboxRepository(Promise.resolve(db)),database:db});
   assert.equal(job.status,"succeeded");assert.equal(calls,1);assert.match(code,/^[0-9]{6}$/);
   assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sandbox_deliveries")).rows[0].count,0);
  }finally{globalThis.fetch=old;await db.close();}
  return code;
 }
 try{
  const migrated=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{cwd:root,env:environment,encoding:"utf8"});
  assert.equal(migrated.status,0,migrated.stderr||migrated.stdout);
  browser=await chromium.launch({headless:true});const context=await browser.newContext();let page=await context.newPage();
  await phase(async()=>{
   await page.goto(baseUrl+"/worker/register");
   for(const [label,value] of [["Full name","Provider Browser Worker"],["Email address","browser.worker@example.test"],["Mobile phone","+923009991122"],["Country","Pakistan"],["Create password","ProviderBrowser!Password2026"],["Confirm password","ProviderBrowser!Password2026"]])
    await page.getByLabel(label,{exact:true}).fill(value);
   await page.getByLabel("I accept the HSE Verify terms for this Worker account.",{exact:true}).check();
   await page.getByLabel("I accept the privacy notice for Worker registration data.",{exact:true}).check();
   await page.getByRole("button",{name:"Create Worker account",exact:true}).click();await page.waitForURL("**/worker/register/verify");
   await page.getByText("Your verification message is queued. Check the contact shown below shortly.",{exact:true}).waitFor();
   assert.equal(await page.getByRole("link",{name:"Open sandbox inbox"}).count(),0);
   assert.ok(!(await page.locator("body").innerText()).includes("Code sent"));
  });
  const emailCode=await delivery("email","browser.worker@example.test");
  await phase(async()=>{
   const currentUrl=page.url();await page.close();page=await context.newPage();await page.goto(currentUrl);await page.getByText("The delivery provider accepted your verification message. Check the contact shown below.",{exact:true}).waitFor();
   await page.getByLabel("Verification code").fill(emailCode);
   await page.getByRole("button",{name:"Verify email",exact:true}).click();
   await page.getByText("Step 2 of 2",{exact:false}).waitFor();
   await page.getByText("Your verification message is queued. Check the contact shown below shortly.",{exact:true}).waitFor();
  });
  const phoneCode=await delivery("phone","+923009991122");
  await phase(async()=>{
   const currentUrl=page.url();await page.close();page=await context.newPage();await page.goto(currentUrl);await page.getByLabel("Verification code").fill(phoneCode);
   await page.getByRole("button",{name:"Verify phone",exact:true}).click();
   await page.getByText("Activation complete",{exact:true}).waitFor();
   await page.goto(baseUrl+"/company/register");
   for(const [label,value] of [["Legal Company name","Provider Browser Safety Limited"],["Trading name","Provider Browser Safety"],["Registration number","PROVIDER-BROWSER-2026"],["Registration country","Pakistan"],["Industry","Safety services"],["Company website","https://provider.example.test"],["Authorized representative","Provider Browser Company"],["Business email","browser.company@example.test"],["Business phone","+923009994455"],["Create password","ProviderBrowser!Password2026"],["Confirm password","ProviderBrowser!Password2026"]])
    await page.getByLabel(label,{exact:true}).fill(value);
   await page.getByLabel("Company size").selectOption("11-50");
   await page.getByLabel("I accept the HSE Verify terms for this Company application.").check();
   await page.getByLabel("I accept the privacy notice for Company verification data and evidence.").check();
   await page.getByRole("button",{name:"Create Company application",exact:true}).click();
   await page.waitForURL("**/company/register/verify");
   await page.getByText("Your verification message is queued. Check the contact shown below shortly.",{exact:true}).waitFor();
   assert.equal(await page.getByRole("link",{name:"Open sandbox inbox"}).count(),0);
  });
  const companyCode=await delivery("email","browser.company@example.test");
  await phase(async()=>{
   const currentUrl=page.url();await page.close();page=await context.newPage();await page.goto(currentUrl);await page.getByText("The delivery provider accepted your verification message. Check the contact shown below.",{exact:true}).waitFor();
   await page.getByLabel("Email verification code").fill(companyCode);
   await page.getByRole("button",{name:"Verify business email",exact:true}).click();
   await page.getByText("Step 2 of 2",{exact:true}).waitFor();
   const setup=await page.locator("code").innerText();
   await page.getByLabel("Authenticator code").fill(totp(setup.trim()));
   await page.getByRole("button",{name:"Activate Company account",exact:true}).click();
   await page.waitForURL("**/company/login?reason=registration-complete");
  });
  const db=await openScriptDatabase(dbEnvironment);
  try{
   const worker=(await db.query("SELECT * FROM auth_accounts WHERE email_normalized='browser.worker@example.test'")).rows[0];
   assert.equal(worker.account_status,"active");assert.ok(worker.email_verified_at);assert.ok(worker.phone_verified_at);
   const company=(await db.query("SELECT a.account_status,m.membership_status,t.tenant_status FROM auth_accounts a JOIN auth_tenant_memberships m ON m.account_id=a.account_id JOIN platform_tenants t ON t.tenant_id=m.tenant_id WHERE a.email_normalized='browser.company@example.test'")).rows[0];
   assert.deepEqual(company,{account_status:"active",membership_status:"active",tenant_status:"pending"});
   assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_sessions")).rows[0].count,0);
   assert.equal((await db.query("SELECT count(*)::int AS count FROM auth_registration_delivery_intents WHERE status='accepted' AND payload_ciphertext IS NULL")).rows[0].count,3);
  }finally{await db.close();}
 }finally{await browser?.close();await rm(directory,{recursive:true,force:true});}
});
