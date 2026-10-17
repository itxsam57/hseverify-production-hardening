import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) bits += B32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
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
        else if (!address || typeof address === "string") reject(new Error("No free port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, credential, role) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}

import {writeFile} from "node:fs/promises";
import {reportCompanyFixture} from "../helpers/report-company-fixture.mjs";
import {prepareSubmittedWorker,advanceThroughAutomatedChecks,markVerified} from "../helpers/duplicate-identity-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";

test("Admin actual duplicate identity outcomes preserve separate people and unblock only the cleared Worker",{timeout:240000},async()=>{
 const base=await reportCompanyFixture();let browser;
 try{
  await base.database.close();const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:base.environment.HSE_PGLITE_DATA_DIR});
  const target=await prepareSubmittedWorker(db,"browser-target",{documentNumber:"DUPLICATE-BROWSER-123",storage:base.storage}),candidate=await prepareSubmittedWorker(db,"browser-candidate",{documentNumber:"DUPLICATEBROWSER123",storage:base.storage});
  await advanceThroughAutomatedChecks(target);await advanceThroughAutomatedChecks(candidate);await markVerified(db,target.submitted.identity.identityId);await target.eligibilityService.evaluate(target.submitted.identity.identityId);
  await db.query("UPDATE auth_accounts SET password_hash=source.password_hash,password_set_at=source.password_set_at FROM auth_accounts source WHERE auth_accounts.account_id=$1 AND source.account_id=$2",[target.worker.accountId,base.credentials.worker.accountId]);
  await db.query("UPDATE auth_accounts SET worker_reference='HSE-REG-DUPLICATE-BROWSER' WHERE account_id=$1",[target.worker.accountId]);
  await db.close();
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;browser=await chromium.launch({headless:true});
  const admin=await(await browser.newContext()).newPage(),worker=await(await browser.newContext()).newPage();const errors=[];for(const page of [admin,worker]){page.on("pageerror",e=>errors.push(e.message));page.on("response",r=>{if(r.status()>=500)errors.push(String(r.status())+" "+new URL(r.url()).pathname);});}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",projectRoot:process.cwd(),environment:base.environment,probe:async({output})=>{
   try{
    await login(admin,baseUrl,base.credentials.admin,"admin");await admin.goto(baseUrl+"/admin/operations");await admin.getByRole("link",{name:"Duplicate identity review",exact:true}).click();
    const article=admin.locator('article[id="'+target.submitted.identity.identityId+'"]');await article.getByText(candidate.submitted.identity.identityId,{exact:true}).first().waitFor();
    const comparison=article.getByRole("region",{name:"Retained identity comparison"});await comparison.getByText("Date of birth: 1995-02-03",{exact:false}).first().waitFor();assert.ok(!(await comparison.innerText()).includes("DUPLICATE-BROWSER-123"));
    const previewUrl=await article.getByRole("link",{name:"Preview matching identity document",exact:true}).getAttribute("href");assert.ok(previewUrl);const preview=await admin.context().request.get(baseUrl+previewUrl);assert.equal(preview.status(),200);assert.match(preview.headers()["content-type"],/application\/pdf/);assert.match(preview.headers()["cache-control"],/no-store/);assert.ok((await preview.body()).subarray(0,5).toString()==="%PDF-");
    const stale=await admin.context().newPage();await stale.goto(admin.url());
    await login(worker,baseUrl,{...base.credentials.worker,email:target.worker.email},"worker");
    const steps=[
     ["duplicate_review","Further independent duplicate review is required. Your submitted identity remains retained."],
     ["recover_existing_account","Use account recovery from the Worker sign-in page or contact support. Your identity records remain separate."],
     ["block_worker_id","Permanent Worker ID remains blocked after authorized review. Contact support for the next review step."],
     ["continue","Permanent Worker ID issued after identity assurance."]
    ];
    for(const [index,[disposition,message]]of steps.entries()){
     await admin.goto(baseUrl+"/admin/operations/duplicate-identities");const form=article.getByRole("form",{name:"Resolve duplicate identity"});
     await form.getByLabel("Identity eligibility outcome").selectOption(disposition);await form.getByLabel("Duplicate review reason").fill("Independent documented identity comparison and reasoned outcome "+disposition+" for this retained record.");await form.getByRole("button",{name:"Record duplicate identity outcome",exact:true}).click();
     if(disposition==="continue")await admin.getByText("No verified identities awaiting duplicate review.",{exact:true}).waitFor();
     else await article.getByText("Duplicate identity outcome recorded.",{exact:true}).waitFor();
     if(index===0){const old=stale.getByRole("form",{name:"Resolve duplicate identity"});await old.getByLabel("Duplicate review reason").fill("Obsolete review tab must not change the current outcome.");await old.getByRole("button",{name:"Record duplicate identity outcome",exact:true}).click();await old.getByRole("alert").getByText("Duplicate review changed; reload before saving.",{exact:true}).waitFor();await stale.close();}
     await worker.goto(baseUrl+"/worker/identity");await worker.getByText(message,{exact:true}).waitFor();assert.ok(!(await worker.content()).includes(candidate.submitted.identity.identityId));assert.ok(!(await worker.content()).includes(candidate.worker.email));
    }
    const oldPreview=await admin.context().request.get(baseUrl+previewUrl);assert.equal(oldPreview.status(),404,"A resolved identity must not retain duplicate-review preview authority");
    const wrongRole=await worker.context().request.get(baseUrl+previewUrl);assert.ok(wrongRole.status()>=400||!wrongRole.headers()["content-type"]?.includes("application/pdf"));
    const denied=await worker.goto(baseUrl+"/admin/operations/duplicate-identities");assert.ok(denied.status()>=400||!worker.url().endsWith("/admin/operations/duplicate-identities"));
   }finally{await writeFile(".autopilot/artifacts/20261015-duplicate-identity-browser-server.log",output());}
  }});
  const proof=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:base.environment.HSE_PGLITE_DATA_DIR});try{assert.equal((await proof.query("SELECT COUNT(*)::integer n FROM worker_identity_worker_ids WHERE worker_account_id=ANY($1::text[])",[[target.worker.accountId,candidate.worker.accountId]])).rows[0].n,1);assert.equal((await proof.query("SELECT COUNT(*)::integer n FROM worker_identity_duplicate_dispositions WHERE check_id IN(SELECT check_id FROM worker_identity_duplicate_checks WHERE identity_id=$1)",[target.submitted.identity.identityId])).rows[0].n,4);}finally{await proof.close();}
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await base.cleanup();}
});
