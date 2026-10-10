import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const EMAIL="masterplan.worker.e2e@example.test";
const PHONE="+923001234567";
const PASSWORD="MasterplanWorker!2026";
const SANDBOX_KEY="masterplan-worker-browser-sandbox-2026";
const PNG={name:"proof.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")};
const B32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(value){const clean=value.toUpperCase().replace(/=+$/g,"");let bits="";for(const c of clean)bits+=B32.indexOf(c).toString(2).padStart(5,"0");const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(Number.parseInt(bits.slice(i,i+8),2));return Buffer.from(bytes);}
const lastTotpCounter=new Map();
function totpAt(secret,counter){const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(counter));const digest=createHmac("sha1",decodeBase32(secret)).update(buf).digest(),offset=digest.at(-1)&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,"0");}
async function freshTotp(key,secret){let counter=Math.floor(Date.now()/30000);const last=lastTotpCounter.get(key);if(last!==undefined&&counter<=last){await new Promise(resolve=>setTimeout(resolve,Math.max(100,(last+1)*30000-Date.now()+150)));counter=Math.floor(Date.now()/30000);}lastTotpCounter.set(key,counter);return totpAt(secret,counter);}
async function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):!a||typeof a==="string"?reject(new Error("No port")):resolve(a.port));});});}
async function login(page,baseUrl,credential,role){await page.goto(`${baseUrl}/${role}/login`,{waitUntil:"domcontentloaded"});await page.getByLabel("Email address").fill(credential.email);await page.getByLabel("Password").fill(credential.password);if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(await freshTotp(credential.email,credential.totpSecret));await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL(`**/${role}/dashboard`,{timeout:30000});}
async function sandboxCode(page,baseUrl,channel,destination){await page.goto(`${baseUrl}/worker/register/sandbox`,{waitUntil:"domcontentloaded"});await page.getByLabel("Delivery channel").selectOption(channel);await page.getByLabel("Delivery destination").fill(destination);await page.getByLabel("Sandbox access key").fill(SANDBOX_KEY);await page.getByRole("button",{name:"Open latest sandbox delivery"}).click();const status=page.getByRole("status",{name:"Latest sandbox verification code"});await status.waitFor({timeout:15000});return (await status.locator("strong").innerText()).trim();}
async function uploadIdentity(page,heading,name,document=false){const card=page.getByRole("region",{name:heading,exact:true});if(document){await card.getByLabel("Document type").selectOption("passport");await card.getByLabel("Document number").fill("PK-MASTERPLAN-E2E-001");await card.getByLabel("Issue date").fill("2025-01-01");await card.getByLabel("Expiry date").fill("2035-01-01");}await card.getByLabel("Choose file").setInputFiles({...PNG,name});await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/identity")),card.getByRole("button",{name:"Upload evidence"}).click()]);}
async function rejectReview(page,baseUrl,kind,reason){await page.goto(`${baseUrl}/verifier/reviews`,{waitUntil:"domcontentloaded"});const row=page.locator("tbody tr").filter({hasText:kind}).first();await row.getByRole("link",{name:"Review"}).click();await page.getByRole("button",{name:"Claim review"}).click();await page.getByText("ASSIGNED",{exact:true}).waitFor({timeout:15000});await page.getByLabel("Decision").selectOption("REJECTED");await page.getByLabel("Reason", { exact: true }).fill(reason);await page.getByRole("button",{name:"Finalize review"}).click();await page.getByText("REJECTED",{exact:true}).waitFor({timeout:15000});}

async function phaseOne(baseUrl,environment,credentials){
  return runDevelopmentServer({
    args:["--hostname","127.0.0.1","--port",String(new URL(baseUrl).port)],probeUrl:`${baseUrl}/worker/register`,projectRoot:process.cwd(),environment,
    probe:async()=>{
      const browser=await chromium.launch({headless:true});
      const workerContext=await browser.newContext({viewport:{width:1440,height:1000},permissions:["clipboard-read","clipboard-write"]});
      const verifierContext=await browser.newContext({viewport:{width:1440,height:1000}});
      const worker=await workerContext.newPage(), verifier=await verifierContext.newPage();
      try{
        await worker.goto(`${baseUrl}/worker/register`,{waitUntil:"domcontentloaded"});
        await worker.getByLabel("Full name").fill("Masterplan Worker");
        await worker.getByLabel("Email address").fill(EMAIL);await worker.getByLabel("Mobile phone").fill(PHONE);
        await worker.getByLabel("Create password").fill(PASSWORD);await worker.getByLabel("Confirm password").fill(PASSWORD);
        await worker.getByLabel("Country", { exact: true }).fill("Pakistan");
        await worker.getByLabel("I accept the HSE Verify terms for this Worker account.", { exact: true }).check();
        await worker.getByLabel("I accept the privacy notice for Worker registration data.", { exact: true }).check();
        await worker.getByRole("button",{name:"Create Worker account"}).click();
        try {
          await worker.waitForURL(/\/worker\/register\/verify/,{timeout:15000});
        } catch (error) {
          console.error("Worker signup returned", worker.url(), await worker.locator("body").innerText());
          console.error("Worker signup field state", await worker.locator("form").first().evaluate(form => Array.from(form.elements).filter(field => field.name && !/password/i.test(field.name)).map(field => ({ name: field.name, value: field.value, checked: field.checked }))));
          throw error;
        }
        const emailCode=await sandboxCode(worker,baseUrl,"email",EMAIL);
        await worker.goto(`${baseUrl}/worker/register/verify`,{waitUntil:"domcontentloaded"});
        await worker.getByLabel("Verification code").fill(emailCode);
        await worker.getByRole("button",{name:"Verify email"}).click();
        await worker.getByText("Step 2 of 2: phone",{exact:true}).waitFor({timeout:15000});
        const phoneCode=await sandboxCode(worker,baseUrl,"phone",PHONE);
        await worker.goto(`${baseUrl}/worker/register/verify`,{waitUntil:"domcontentloaded"});
        await worker.getByLabel("Verification code").fill(phoneCode);
        await worker.getByRole("button",{name:"Verify phone"}).click();
        await worker.waitForURL(/\/worker\/register\/verify\?stage=complete/,{timeout:15000});
        await worker.getByRole("link",{name:"Worker sign-in",exact:true}).click();await worker.getByLabel("Email address").fill(EMAIL);await worker.getByLabel("Password").fill(PASSWORD);await worker.getByRole("button",{name:"Sign in",exact:true}).click();await worker.waitForURL(/\/worker\/(dashboard|onboarding)/,{timeout:15000});

        const unverifiedApplications = await worker.goto(`${baseUrl}/worker/assessment-applications`);assert.equal(unverifiedApplications?.status(),200);await worker.getByRole("heading",{name:"No eligible assessment applications"}).waitFor();
        await worker.goto(`${baseUrl}/worker/profile?section=personal`);await worker.getByLabel("Legal first name").fill("Masterplan");await worker.getByLabel("Legal last name").fill("Worker");await worker.getByLabel("Preferred name").fill("MP");await worker.getByLabel("Date of birth").fill("1990-01-15");await worker.getByLabel("Nationality").fill("Pakistani");await worker.getByLabel("Country of residence").fill("Pakistan");await worker.getByLabel("Primary language").fill("English");await worker.getByRole("button",{name:"Save and continue"}).click();
        await worker.getByLabel("Country code").fill("+92");await worker.getByLabel("Phone number").fill("3001234567");await worker.getByLabel("Address line 1").fill("1 Safety Street");await worker.getByLabel("City").fill("Lahore");await worker.getByLabel("Region or province").fill("Punjab");await worker.getByLabel("Postal code").fill("54000");await worker.getByRole("button",{name:"Save and continue"}).click();
        await worker.getByLabel("Primary occupation or trade").fill("Safety Officer");await worker.getByLabel("Years of experience").fill("7");await worker.getByLabel("Current employment status").selectOption("employed");await worker.getByLabel("Preferred work countries").fill("Pakistan, Saudi Arabia");await worker.getByRole("button",{name:"Save changes"}).click();await worker.reload();await worker.getByRole("button",{name:"Submit profile"}).click();await worker.getByText("Profile submitted",{exact:true}).waitFor({timeout:15000});

        await worker.goto(`${baseUrl}/worker/identity`);await worker.getByLabel("Legal first name").fill("Masterplan");await worker.getByLabel("Legal last name").fill("Worker");await worker.getByLabel("Date of birth").fill("1990-01-15");await worker.getByLabel("Nationality").fill("Pakistani");await worker.getByLabel("Country of residence").fill("Pakistan");await worker.getByRole("button",{name:"Save identity details"}).click();await worker.reload();
        await uploadIdentity(worker,"Identity document","passport.png",true);await uploadIdentity(worker,"Profile photo","profile.png");await uploadIdentity(worker,"Selfie evidence","selfie.png");await worker.reload();await worker.getByRole("button",{name:"Submit identity"}).click();await worker.getByText("Manual review",{exact:true}).first().waitFor({timeout:15000});

        await login(verifier,baseUrl,credentials.verifier,"verifier");
        const reason="The submitted identity document does not establish the claimed identity; initial verification is rejected.";
        await rejectReview(verifier,baseUrl,"identity",reason);
        await worker.goto(`${baseUrl}/worker/identity`);
        await worker.getByRole("heading",{name:"Rejected",exact:true}).waitFor();
        await worker.getByRole("region",{name:"Latest identity review",exact:true}).getByText(reason,{exact:true}).waitFor();
        assert.equal(await worker.getByRole("button",{name:"Start identity revision",exact:true}).count(),0);
        assert.equal(await worker.getByRole("button",{name:"Submit identity",exact:true}).count(),0);
        await worker.reload();await worker.getByRole("heading",{name:"Rejected",exact:true}).waitFor();
        await worker.getByRole("region",{name:"Latest identity review",exact:true}).getByText(reason,{exact:true}).waitFor();
        console.log("ACTUAL_INITIAL_IDENTITY_REJECTION retained rejected state/reason, no invented correction/submit route");
      } finally {await workerContext.close();await verifierContext.close();await browser.close();}
    }
  });
}


test("Initial identity rejection preserves submitted version, reason and terminal policy",{timeout:180000},async()=>{
 const root=process.cwd(),dbDir=await mkdtemp(join(tmpdir(),'hse-initial-identity-rejection-')),port=await freePort(),baseUrl='http://127.0.0.1:'+port;
 const env={...process.env,HSE_APP_ENV:'development',HSE_DATABASE_DRIVER:'pglite',HSE_PGLITE_DATA_DIR:dbDir,HSE_AUDIT_CREDENTIALS_PATH:join(dbDir,'audit-credentials.json'),HSE_RELEASE_SHA:'initial-identity-rejection',HSE_SESSION_SECRET:'initial-identity-rejection-session-secret-more-than-thirty-two',HSE_AUTH_PEPPER:'initial-identity-rejection-auth-pepper-more-than-thirty-two',HSE_ENABLE_AUTH_SANDBOX:'true',HSE_AUTH_SANDBOX_ACCESS_KEY:SANDBOX_KEY,HSE_ENABLE_WORKER_DEMO_AUTH:'false',HSE_USE_WORKER_DEMO_DATA:'false'};
 try{
  for(const script of ['scripts/db-migrate.mjs','scripts/independent-audit-seed.mjs']){const r=spawnSync(process.execPath,[script],{cwd:root,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile(env.HSE_AUDIT_CREDENTIALS_PATH,'utf8'));const result=await phaseOne(baseUrl,env,credentials);assert.equal(result.requestedSignal,'SMOKE_COMPLETE');
  const db=new PGlite(dbDir);try{
   const account=(await db.query('SELECT account_id FROM auth_accounts WHERE email_normalized=$1',[EMAIL])).rows[0];
   const identity=(await db.query('SELECT * FROM worker_identities WHERE worker_account_id=$1',[account.account_id])).rows[0];assert.equal(identity.lifecycle_status,'rejected');assert.equal(identity.current_version_number,1);
   const versions=(await db.query('SELECT * FROM worker_identity_versions WHERE identity_id=$1',[identity.identity_id])).rows;assert.equal(versions.length,1);assert.equal(versions[0].version_status,'submitted');assert.ok(versions[0].submitted_at);
   const decisions=(await db.query("SELECT d.* FROM evidence_review_decisions d JOIN evidence_review_tasks t ON t.task_id=d.task_id WHERE t.worker_account_id=$1 AND t.evidence_kind='identity'",[account.account_id])).rows;assert.equal(decisions.length,1);assert.equal(decisions[0].outcome,'REJECTED');assert.equal(decisions[0].source_version_id,versions[0].identity_version_id);assert.equal(decisions[0].verifier_account_id,credentials.verifier.accountId);
   assert.equal((await db.query('SELECT count(*)::int n FROM worker_identity_worker_ids WHERE worker_account_id=$1',[account.account_id])).rows[0].n,0);
   await assert.rejects(db.query("UPDATE worker_identity_versions SET version_status='draft',submitted_at=NULL WHERE identity_version_id=$1",[versions[0].identity_version_id]),/immutable|submitted|frozen/i);
   console.log('ACTUAL_INITIAL_IDENTITY_REJECTION_DB one preserved submitted version, exact reasoned human decision, no permanent ID');
  }finally{await db.close();}
 }finally{await rm(dbDir,{recursive:true,force:true});}
});
