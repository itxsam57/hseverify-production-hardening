import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHmac} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
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


test("Configured six-role recovery email dispatch resets password, revokes sessions and preserves MFA", {timeout:360000},async()=>{
 const root=process.cwd(),temporary=await mkdtemp(join(tmpdir(),"hse-recovery-provider-browser-")),directory=join(temporary,"db"),credentialsPath=join(temporary,"credentials.json"),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const pepper="recovery-browser-auth-pepper-more-than-thirty-two",providers={emailApiKey:"fixture-email-key",emailFrom:"verify@example.test"};
 const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,HSE_AUDIT_CREDENTIALS_PATH:credentialsPath,
  HSE_RELEASE_SHA:"recovery-provider-browser",HSE_SESSION_SECRET:"recovery-browser-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:pepper,
  HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",
  HSE_OTP_EMAIL_API_KEY:providers.emailApiKey,HSE_OTP_EMAIL_FROM:providers.emailFrom};
 const dbEnvironment={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:directory,releaseSha:"recovery-provider-browser",
  sessionSecret:environment.HSE_SESSION_SECRET,authPepper:pepper,authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false,registrationOtpProviders:providers};
 setWorkerRegistrationRuntimeEnvironment(dbEnvironment);
 let browser;
 let phaseNumber=0;
 async function phase(probe){
  const number=++phaseNumber;console.log("Recovery browser phase start",number);
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment,
   probe:async({output})=>{console.log("Recovery browser phase ready",number);try{await probe();}catch(error){console.log("Recovery browser failure",number,output().slice(-1800));throw error;}}});
  console.log("Recovery browser phase complete",number);
 }
 async function signIn(page,identity,role,password,offset=0){
  await page.goto(baseUrl+"/"+role+"/login");await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password",{exact:true}).fill(password);
  if(identity.totpSecret)await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret,offset));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
 }
 async function delivery(destination){
  const db=await openScriptDatabase(dbEnvironment),old=globalThis.fetch;let code,calls=0;
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,"https://api.resend.com/emails");calls++;
   const body=JSON.parse(options.body);assert.deepEqual(body.to,[destination]);code=body.text.match(/code is ([0-9]{6})/)[1];
   return new Response(JSON.stringify({id:"recovery-browser-accepted"}),{status:200});
  };
  try {
   for(let i=0;i<20;i++){
    const job=await processNextOutboxJob({database:db,repository:new DatabaseOutboxRepository(Promise.resolve(db))});
    assert.ok(job,"Recovery work must be queued");
    if(job.jobType==="authentication.challenge.delivery"){assert.equal(job.status,"succeeded");break;}
   }
   assert.equal(calls,1);assert.match(code,/^[0-9]{6}$/);
  }finally{globalThis.fetch=old;await db.close();}
  return code;
 }
 try {
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
   const result=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(result.status,0,result.stderr||result.stdout);
  }
  console.log("Recovery browser fixtures seeded");
  const credentials=JSON.parse(await readFile(credentialsPath,"utf8"));browser=await chromium.launch({headless:true});
  const newPassword="RecoveredProvider!Password2026";
  for(const role of ["worker","company","assessor","verifier","admin","root"]){
   console.log("Recovery browser role",role);
   const identity=credentials[role],oldContext=await browser.newContext(),context=await browser.newContext();oldContext.setDefaultNavigationTimeout(15000);context.setDefaultNavigationTimeout(15000);oldContext.setDefaultTimeout(15000);context.setDefaultTimeout(15000);let oldPage=await oldContext.newPage(),page=await context.newPage(),verifyUrl;
   await phase(async()=>{
    await signIn(oldPage,identity,role,identity.password);await oldPage.waitForURL("**/"+role+"/dashboard").catch(async error=>{console.log("Recovery old login failure",role,await oldPage.getByRole("alert").allTextContents());throw error;});
    await page.goto(baseUrl+"/auth/recover?portal="+role);await page.getByLabel("Account email").fill(identity.email);
    await page.getByRole("button",{name:"Continue securely",exact:true}).click();await page.waitForURL("**/auth/recover/verify?portal="+role);
    await page.getByRole("button",{name:"Send a new recovery code",exact:true}).click();
    await page.getByText("If this account is eligible, check your email for the latest recovery code.",{exact:true}).waitFor();
    verifyUrl=page.url();await page.close();await oldPage.close();
   });
   const code=await delivery(identity.email);
   await phase(async()=>{
    page=await context.newPage();oldPage=await oldContext.newPage();await page.goto(verifyUrl);console.log("Recovery verify page loaded",role,new URL(page.url()).pathname);
    await page.getByLabel("Recovery code",{exact:true}).fill(code);await page.getByLabel("New password",{exact:true}).fill(newPassword);
    await page.getByLabel("Confirm new password",{exact:true}).fill(newPassword);
    await page.getByRole("button",{name:"Reset password and revoke sessions",exact:true}).click();await page.waitForURL("**/"+role+"/login?reason=password-reset").catch(async error=>{console.log("Recovery reset failure",role,new URL(page.url()).pathname,await page.getByRole("alert").allTextContents());throw error;});
    await oldPage.goto(baseUrl+"/"+role+"/dashboard");await oldPage.waitForURL("**/"+role+"/login**");
    await signIn(page,identity,role,identity.password);await page.getByRole("alert").filter({hasText:"The email, password or verification code is incorrect."}).waitFor();
    assert.ok(page.url().includes("/"+role+"/login"));
    if(identity.totpSecret){
     await page.getByLabel("Password",{exact:true}).fill(newPassword);await page.getByLabel("Authenticator code").fill("");
     const denied=page.waitForResponse(response=>response.request().method()==="POST" && new URL(response.url()).pathname==="/"+role+"/login");
     await page.getByRole("button",{name:"Sign in",exact:true}).click();await denied;await page.getByRole("button",{name:"Sign in",exact:true}).waitFor();await page.getByRole("alert").filter({hasText:"The email, password or verification code is incorrect."}).waitFor();assert.ok(page.url().includes("/"+role+"/login"));
    }
    await signIn(page,identity,role,newPassword,1);await page.waitForURL("**/"+role+"/dashboard");
   });
   await oldContext.close();await context.close();
  }
  const db=await openScriptDatabase(dbEnvironment);try{
   assert.equal((await db.query("SELECT count(*)::int n FROM auth_registration_delivery_intents WHERE status='accepted' AND payload_ciphertext IS NULL")).rows[0].n,6);
   assert.equal((await db.query("SELECT count(*)::int n FROM auth_recovery_flows WHERE consumed_at IS NOT NULL")).rows[0].n,6);
   assert.equal((await db.query("SELECT count(*)::int n FROM auth_sessions WHERE revocation_reason='password_reset'")).rows[0].n,6);
   assert.equal((await db.query("SELECT count(*)::int n FROM auth_sandbox_deliveries")).rows[0].n,0);
  }finally{await db.close();}
 }finally{await browser?.close();await rm(temporary,{recursive:true,force:true});}
});


test("Unavailable production recovery is disabled and server action rejects client bypass without creating a flow",{timeout:60000},async()=>{
 const root=process.cwd(),temporary=await mkdtemp(join(tmpdir(),'hse-recovery-unavailable-')),directory=join(temporary,'db'),port=await freePort(),baseUrl='http://127.0.0.1:'+port;
 const environment={...process.env,HSE_APP_ENV:'test',HSE_DATABASE_DRIVER:'pglite',HSE_PGLITE_DATA_DIR:directory,HSE_RELEASE_SHA:'recovery-unavailable-browser',HSE_SESSION_SECRET:'recovery-unavailable-session-secret-more-than-thirty-two',HSE_AUTH_PEPPER:'recovery-unavailable-auth-pepper-more-than-thirty-two',HSE_ENABLE_AUTH_SANDBOX:'false',HSE_ENABLE_WORKER_DEMO_AUTH:'false',HSE_USE_WORKER_DEMO_DATA:'false'};
 for(const key of ['HSE_OTP_EMAIL_API_KEY','HSE_OTP_EMAIL_FROM','HSE_OTP_SMS_ACCOUNT_SID','HSE_OTP_SMS_AUTH_TOKEN','HSE_OTP_SMS_FROM'])delete environment[key];
 const migration=spawnSync(process.execPath,['scripts/db-migrate.mjs'],{cwd:root,env:environment,encoding:'utf8'});assert.equal(migration.status,0,migration.stderr||migration.stdout);
 let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);
  await runDevelopmentServer({args:['--hostname','127.0.0.1','--port',String(port)],probeUrl:baseUrl+'/worker/login',projectRoot:root,environment,probe:async()=>{
   await page.goto(baseUrl+'/auth/recover?portal=worker');
   assert.equal(await page.getByRole('button',{name:'Continue securely',exact:true}).isDisabled(),true);
   await page.getByText('Email recovery is temporarily unavailable.',{exact:true}).waitFor();
   await page.getByLabel('Account email').fill('unknown.recovery@example.test');
   const response=page.waitForResponse(value=>value.request().method()==='POST' && new URL(value.url()).pathname==='/auth/recover');
   await page.locator('form.auth-form').evaluate(form=>form.requestSubmit());await response;
   await page.getByRole('alert').filter({hasText:'Password recovery is temporarily unavailable. Please try again later.'}).waitFor();
   assert.equal(new URL(page.url()).pathname,'/auth/recover');assert.ok(!(await page.context().cookies()).some(cookie=>cookie.name.includes('recovery')));
  }});
  const db=await openScriptDatabase({appEnvironment:'test',databaseDriver:'pglite',databaseUrl:null,pgliteDataDir:directory,releaseSha:'recovery-unavailable-browser',sessionSecret:environment.HSE_SESSION_SECRET,authPepper:environment.HSE_AUTH_PEPPER,authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false});
  try{for(const table of ['auth_recovery_flows','auth_otp_challenges','auth_registration_delivery_intents'])assert.equal((await db.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);}finally{await db.close();}
 }finally{await browser?.close();await rm(temporary,{recursive:true,force:true});}
});
